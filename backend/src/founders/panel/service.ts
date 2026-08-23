/**
 * The Admin Founder panel's own services — migration 0059, 2026-08-22.
 *
 * ── What this module is, and what it is not ────────────────────────────────
 * `founders/workspace.ts` already composes the Founder record: identity,
 * campaigns, money, standing, history. This module composes only the panel's
 * SUPPLEMENT — the eleven-stage workflow position, the application-review
 * record, the Admin offers, the internal notes, the invite prefills, and the
 * two version numbers — and it does not restate one field the workspace already
 * answers. Two composers answering the same question is two answers waiting to
 * disagree (§33.8.13), and the workspace is the older one.
 *
 * ── Every prior value is read under lock ───────────────────────────────────
 * §25.6, as §33.12.4 tests it: "the prior value is read from the row under lock
 * inside the transaction that changes it — a caller that supplies both halves
 * can supply a flattering pair." No function here takes a prior value, and no
 * route below can pass one. Each write opens a transaction, takes `FOR UPDATE`
 * on the row it is about to change, reads what is there, writes, and records
 * both halves in the same transaction as the change.
 *
 * ── The audit row is written inside the transaction ────────────────────────
 * `createAuditWriter` closes over the pool, so an audit written through it
 * lands in its own transaction and a crash between commit and audit leaves a
 * change with no event. `vetting/claim.ts` already writes `audit_events`
 * directly for the same reason; `insertAuditEvent` below is that call with the
 * writer's column mapping, so the two produce identical rows.
 *
 * ── The offer is never a proposal version ──────────────────────────────────
 * §14.2 makes compensation bilateral, and `routes/admin-decisions.ts` records
 * that the ABSENT accept-route is the enforcement: "Admin cannot substitute for
 * either party's acceptance." `recordAdminOffer` writes
 * `association_admin_offers` and NOTHING ELSE. It creates no `proposal_versions`
 * row, touches no `association_compensation_agreements` row, and moves no
 * association status — the Founder still responds through the route they
 * already use. The association row is left byte-for-byte unchanged, which is
 * the property a test can check.
 */

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditEvents } from '../../db/schema/integrity.js';
import { campaigns, campaignAffiliateAssociations } from '../../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { founderClaimProfiles } from '../../db/schema/vetting.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import {
  approvedCampaignSnapshots,
  campaignBuild,
  campaignFaqs,
  campaignRewardPackages,
} from '../../db/schema/build.js';
import {
  associationAdminOffers,
  associationFinalCampaignSends,
  campaignAdminFieldEdits,
  campaignApplicationChangeRequests,
  campaignApplicationReviews,
  founderAccountWarnings,
  founderInternalNotes,
} from '../../db/schema/admin-founder-panel.js';
import { recomputeBuildStatus } from '../../campaign/service.js';
import { loadFounderContext } from '../workspace.js';
import { readAdminWorkspace } from '../../workspace/projection.js';
import { OPTIONAL_ITEM_KEYS } from '../../workspace/registry.js';
import {
  APPLICATION_REVIEW_OUTCOMES,
  applicationReviewDecided,
  applicationReviewLabel,
  isApplicationReviewOutcome,
  isFounderWorkflowStage,
  prefillAffiliateTypeLabel,
  stageForStatus,
  FOUNDER_WORKFLOW_EXIT_STATUSES,
  FOUNDER_WORKFLOW_LABELS,
  FOUNDER_WORKFLOW_STAGE_IDS,
  PREFILL_AFFILIATE_TYPE_IDS,
  workflowStageAvailable,
  workflowStageIndex,
  type ApplicationReviewOutcome,
  type FounderWorkflowStageId,
} from './workflow.js';
import { applicationFieldByKey } from './application-fields.js';
import {
  coerceSetupValue,
  liveEditRefusal,
  renderStoredValue,
  resolveSetupField,
  SETUP_FIELD_GROUP_LABELS,
  type SetupFieldDefinition,
} from './setup-fields.js';

/* ── Shared plumbing ───────────────────────────────────────────────────────── */

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PanelActor {
  /** `user:<id>`, resolved from the guarded session and never from a body. */
  actor: string;
  mfaContext: string;
  reauthContext: string;
}

/** `createAuditWriter`'s mapping, callable inside a transaction. */
async function insertAuditEvent(
  tx: Tx,
  who: PanelActor,
  event: {
    action: string;
    targetType: string;
    targetId: string;
    internalReason: string;
    customerExplanation?: string | null;
    priorValue?: unknown;
    newValue?: unknown;
    evidenceLinks?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.insert(auditEvents).values({
    actor: who.actor,
    mfaContext: who.mfaContext,
    reauthContext: who.reauthContext,
    targetType: event.targetType,
    targetId: event.targetId,
    action: event.action,
    internalReason: event.internalReason,
    customerExplanation: event.customerExplanation ?? null,
    priorValue: event.priorValue ?? null,
    newValue: event.newValue ?? null,
    evidenceLinks: event.evidenceLinks ?? null,
  });
}

export type PanelRefusal = { ok: false; code: string; message: string; next: string };

function refuse(code: string, message: string, next: string): PanelRefusal {
  return { ok: false, code, message, next };
}

const UUID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function looksLikeId(value: string): boolean {
  return UUID_SHAPE.test(value);
}

/* ══ 1. The panel supplement ═══════════════════════════════════════════════ */

export interface WorkflowStageView {
  id: FounderWorkflowStageId;
  label: string;
  available: boolean;
  current: boolean;
}

export interface FounderPanelView {
  prospectId: string;
  campaignId: string | null;
  workflow: {
    /** Where the record IS. Null for the four statuses that exit the workflow. */
    stage: FounderWorkflowStageId | null;
    stageLabel: string | null;
    /** The ratchet — the furthest stage ever reached. Unlocks the menu. */
    stageReached: FounderWorkflowStageId;
    stageReachedLabel: string;
    /** Set when `campaigns.status` is an exit rather than a position. */
    exitStatus: string | null;
    stages: WorkflowStageView[];
  };
  applicationReview: ApplicationReviewView | null;
  applicationReviewRequirement: {
    required: boolean;
    locked: boolean;
    lockedReason: string | null;
  } | null;
  /** Every round, newest first, so `Application version` reads `rounds.length`. */
  applicationRounds: number;
  offers: AdminOfferView[];
  finalCampaignSends: FinalCampaignSendView[];
  notes: InternalNoteView[];
  warnings: AccountWarningView[];
  invitePrefills: InvitePrefillView | null;
  identity: {
    username: string | null;
    usernameSupplier: string | null;
    emailCodeVerifiedAt: string | null;
    /** From `audit_events` action `founder.password_set`. There is no column. */
    passwordSetAt: string | null;
    lastActiveAt: string | null;
  };
  versions: {
    /** `campaign_build.draft_version`. Bumped by every recorded Admin edit. */
    draftVersion: number | null;
    /** Stamped onto the immutable approved snapshot at approval. */
    publishedVersion: number | null;
  };
  recentFieldEdits: FieldEditView[];
  optionalItems: Array<{
    key: string;
    complete: boolean;
    savingCents: string | null;
    content: string | null;
    logo: string | null;
    colors: string | null;
    assets: Array<{
      id: string;
      filename: string;
      contentType: string;
    }>;
    interview: {
      status: string;
      scheduledAt: string | null;
      timezone: string | null;
      provider: string | null;
    } | null;
    source: string;
    reason: string | null;
  }> | null;
  listingFee: {
    status: string;
    calculatedAt: string | null;
    baseCents: string;
    lines: Array<{
      key: string;
      label: string;
      amountCents: string;
      qualifies: boolean;
    }>;
    subtotalCents: string;
    savedCents: string;
    minSubtotalCents: string;
    taxCents: null;
    totalCents: null;
    paid: boolean;
    paidAt: string | null;
    transactionId: null;
    nextLabel: string;
  } | null;
}

export interface ApplicationReviewView {
  id: string;
  round: number;
  outcome: string;
  outcomeLabel: string;
  decided: boolean;
  reviewer: string | null;
  decidedAt: string | null;
  internalReason: string | null;
  customerExplanation: string | null;
  openedAt: string;
  changeRequests: {
    id: string;
    fieldKey: string;
    fieldLabel: string | null;
    reason: string;
    requestedBy: string;
    requestedAt: string;
    resolvedAt: string | null;
  }[];
}

export interface AdminOfferView {
  id: string;
  associationId: string;
  /** Basis points. 3250 is 32.5%. Never a float, never a percent column. */
  offerBasisPoints: number;
  offeredBy: string;
  internalReason: string;
  offeredAt: string;
  supersededAt: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  live: boolean;
}

export interface FinalCampaignSendView {
  id: string;
  associationId: string;
  sentAt: string;
  sentBy: string;
  openedAt: string | null;
  /** NULL is a state — recorded, not confirmed delivered (§27.2). */
  notificationId: string | null;
}

export interface InternalNoteView {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface InvitePrefillView {
  draftId: string;
  viewsCount: number | null;
  affiliateMatches: number | null;
  affiliateType: string | null;
  affiliateTypeLabel: string | null;
  brandVoice1: string | null;
  brandVoice2: string | null;
  updatedAt: string;
}

export interface FieldEditView {
  id: string;
  fieldKey: string;
  fieldLabel: string | null;
  fieldGroup: string | null;
  priorValue: string | null;
  newValue: string | null;
  internalReason: string;
  materiality: string | null;
  actor: string;
  editedAt: string;
}

const RECENT_EDIT_LIMIT = 50;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The panel's supplement for one PERSON.
 *
 * Keyed on `founder_prospects.id`, like every other Founder workspace read —
 * a Founder whose campaign was archived-and-restarted is one person with more
 * than one campaign, and the prospect is what survives a restart.
 *
 * Returns null for an unknown or unreadable id, which is the same answer a real
 * miss gets: there is no Founder at that address.
 */
export async function readFounderPanel(
  db: Database,
  prospectId: string,
): Promise<FounderPanelView | null> {
  const ctx = await loadFounderContext(db, prospectId);
  if (!ctx) return null;

  const campaign = ctx.currentCampaign?.campaign ?? null;
  const campaignId = campaign?.id ?? null;
  const allCampaignIds = ctx.campaignRows.map((row) => row.campaign.id);
  const optionalWorkspace = campaignId ? await readAdminWorkspace(db, campaignId) : null;

  /* ── Workflow position ─────────────────────────────────────────────────── */

  const status = campaign?.status ?? null;
  const rawReached = campaign?.workflowStageReached ?? 'invite';
  const stageReached: FounderWorkflowStageId = isFounderWorkflowStage(rawReached)
    ? rawReached
    : 'invite';

  // Read once, used twice: the workflow position below needs the newest round,
  // and so does the Application-review pane. Two reads of one table is two
  // answers that can disagree across the gap between them.
  const reviewRows = campaignId
    ? await db
        .select()
        .from(campaignApplicationReviews)
        .where(eq(campaignApplicationReviews.campaignId, campaignId))
        .orderBy(desc(campaignApplicationReviews.round))
    : [];
  const latestReview = reviewRows[0] ?? null;

  // `review` has no lifecycle status of its own (§9 defines none), so a record
  // sits there when vetting is submitted and a round is open. That derivation
  // needs the review row, which is why it lives here and not in the register.
  const derivedStage = stageForStatus(status);
  const preFeeStatus = status === 'vetting_submitted' || status === 'account_claimed';
  const stage: FounderWorkflowStageId | null =
    campaign?.applicationReviewRequired && latestReview && preFeeStatus
      ? latestReview.outcome === 'approved'
        ? 'fee'
        : 'review'
      : !campaign?.applicationReviewRequired && stageReached === 'fee' && preFeeStatus
        ? 'fee'
        : derivedStage;

  const exitStatus =
    status && FOUNDER_WORKFLOW_EXIT_STATUSES.includes(status) ? status : null;

  const stages: WorkflowStageView[] = FOUNDER_WORKFLOW_STAGE_IDS.map((id) => ({
    id,
    label: FOUNDER_WORKFLOW_LABELS[id],
    available: workflowStageAvailable(id, stageReached),
    current: id === stage,
  }));

  /* ── Application review ────────────────────────────────────────────────── */

  const changeRequestRows = latestReview
    ? await db
        .select()
        .from(campaignApplicationChangeRequests)
        .where(eq(campaignApplicationChangeRequests.reviewId, latestReview.id))
        .orderBy(desc(campaignApplicationChangeRequests.requestedAt))
    : [];

  const applicationReview: ApplicationReviewView | null = latestReview
    ? {
        id: latestReview.id,
        round: latestReview.round,
        outcome: latestReview.outcome,
        outcomeLabel: applicationReviewLabel(latestReview.outcome),
        decided: applicationReviewDecided(latestReview.outcome),
        reviewer: latestReview.reviewer,
        decidedAt: iso(latestReview.decidedAt),
        internalReason: latestReview.internalReason,
        customerExplanation: latestReview.customerExplanation,
        openedAt: latestReview.openedAt.toISOString(),
        changeRequests: changeRequestRows.map((row) => ({
          id: row.id,
          fieldKey: row.fieldKey,
          fieldLabel: applicationFieldByKey(row.fieldKey)?.label ?? null,
          reason: row.reason,
          requestedBy: row.requestedBy,
          requestedAt: row.requestedAt.toISOString(),
          resolvedAt: iso(row.resolvedAt),
        })),
      }
    : null;

  const requirementLocked =
    reviewRows.length > 0 ||
    workflowStageIndex(stageReached) > workflowStageIndex('onboarding') ||
    (status !== null && !['invited_draft', 'vetting_submitted', 'account_claimed'].includes(status));
  const applicationReviewRequirement = campaign
    ? {
        required: campaign.applicationReviewRequired,
        locked: requirementLocked,
        lockedReason: requirementLocked
          ? reviewRows.length > 0
            ? 'Application Review has already started, so its requirement cannot be changed.'
            : 'This campaign has already entered payment or a later stage, so Application Review cannot be inserted or removed.'
          : null,
      }
    : null;

  /* ── Offers and final-campaign sends ───────────────────────────────────── */

  const offerRows = campaignId
    ? await db
        .select()
        .from(associationAdminOffers)
        .where(eq(associationAdminOffers.campaignId, campaignId))
        .orderBy(desc(associationAdminOffers.offeredAt))
    : [];

  const sendRows = campaignId
    ? await db
        .select()
        .from(associationFinalCampaignSends)
        .where(eq(associationFinalCampaignSends.campaignId, campaignId))
        .orderBy(desc(associationFinalCampaignSends.sentAt))
    : [];

  /* ── Notes, prefills, identity ─────────────────────────────────────────── */

  const noteRows = await db
    .select()
    .from(founderInternalNotes)
    .where(eq(founderInternalNotes.prospectId, prospectId))
    .orderBy(desc(founderInternalNotes.createdAt));
  const warningRows = await db
    .select()
    .from(founderAccountWarnings)
    .where(eq(founderAccountWarnings.prospectId, prospectId))
    .orderBy(desc(founderAccountWarnings.createdAt));

  const draft = ctx.currentDraft;
  const invitePrefills: InvitePrefillView | null = draft
    ? {
        draftId: draft.id,
        viewsCount: draft.prefillViewsCount,
        affiliateMatches: draft.prefillAffiliateMatches,
        affiliateType: draft.prefillAffiliateType,
        affiliateTypeLabel: prefillAffiliateTypeLabel(draft.prefillAffiliateType),
        brandVoice1: draft.prefillBrandVoice1,
        brandVoice2: draft.prefillBrandVoice2,
        updatedAt: draft.updatedAt.toISOString(),
      }
    : null;

  // §5.2 gives the Founder email/password or Google, and the fact that they
  // chose a password is recorded only as an audit event — there is no column,
  // and §33.1.8's scan is why one may not be added. The projection is the read
  // path the reference's `Password · <time>` row needs.
  const passwordSetAt = allCampaignIds.length
    ? await readPasswordSetAt(db, allCampaignIds)
    : null;

  /* ── Versions ──────────────────────────────────────────────────────────── */

  const [buildRow] = campaignId
    ? await db
        .select({ draftVersion: campaignBuild.draftVersion })
        .from(campaignBuild)
        .where(eq(campaignBuild.campaignId, campaignId))
        .limit(1)
    : [];

  const [snapshotRow] = campaignId
    ? await db
        .select({ publishedVersion: approvedCampaignSnapshots.publishedVersion })
        .from(approvedCampaignSnapshots)
        .where(eq(approvedCampaignSnapshots.campaignId, campaignId))
        .orderBy(desc(approvedCampaignSnapshots.createdAt))
        .limit(1)
    : [];

  const editRows = campaignId
    ? await db
        .select()
        .from(campaignAdminFieldEdits)
        .where(eq(campaignAdminFieldEdits.campaignId, campaignId))
        .orderBy(desc(campaignAdminFieldEdits.editedAt))
        .limit(RECENT_EDIT_LIMIT)
    : [];

  const discountByItem = new Map(
    optionalWorkspace?.fee?.discountLines.map((line) => [line.item, line.discountCents]) ?? [],
  );
  const visibleAssets = optionalWorkspace?.assets.filter((asset) => !asset.removed) ?? [];
  const downloadableAssets = visibleAssets
    .filter(
      (asset) =>
        asset.state === 'stored' && (asset.purpose === 'visual' || asset.purpose === 'logo'),
    )
    .map((asset) => ({
      id: asset.id,
      filename: asset.filename ?? `${asset.purpose}-upload`,
      contentType: asset.contentType,
      purpose: asset.purpose,
    }));
  const visibleLinks = optionalWorkspace?.visualLinks.filter((link) => !link.removed) ?? [];
  const visibleSocials = optionalWorkspace?.socials.filter((social) => !social.removed) ?? [];
  const itemByKey = new Map(
    optionalWorkspace?.items
      .filter((item) => item !== null)
      .map((item) => [item.item, item]) ?? [],
  );
  const rejectionReason = (codes: string[]): string | null =>
    codes.length
      ? codes.map((code) => code.replaceAll('_', ' ')).join(' · ')
      : null;

  const optionalItems = optionalWorkspace
    ? OPTIONAL_ITEM_KEYS.map((key) => {
        const item = itemByKey.get(key);
        const visuals = visibleAssets
          .filter((asset) => asset.purpose === 'visual')
          .map((asset) => asset.filename)
          .filter((name): name is string => Boolean(name));
        const logos = visibleAssets
          .filter((asset) => asset.purpose === 'logo')
          .map((asset) => asset.filename)
          .filter((name): name is string => Boolean(name));
        const booking = optionalWorkspace.interview.booking;

        const content =
          key === 'visuals'
            ? [...visuals, ...visibleLinks.map((link) => link.url)].join(' · ') || null
            : key === 'branding'
              ? optionalWorkspace.workspace.brand.colors
              : key === 'interview'
                ? booking?.scheduledAt?.toISOString() ?? null
                : key === 'story'
                  ? optionalWorkspace.workspace.story.text
                  : visibleSocials.map((social) => social.url).join(' · ') || null;

        return {
          key,
          complete: item?.complete ?? false,
          savingCents: discountByItem.get(key) ?? null,
          content,
          logo: key === 'branding' ? logos.join(' · ') || null : null,
          colors: key === 'branding' ? optionalWorkspace.workspace.brand.colors : null,
          assets:
            key === 'visuals'
              ? downloadableAssets
                  .filter((asset) => asset.purpose === 'visual')
                  .map(({ purpose: _purpose, ...asset }) => asset)
              : key === 'branding'
                ? downloadableAssets
                    .filter((asset) => asset.purpose === 'logo')
                    .map(({ purpose: _purpose, ...asset }) => asset)
                : [],
          interview:
            key === 'interview' && booking
              ? {
                  status: booking.status,
                  scheduledAt: booking.scheduledAt?.toISOString() ?? null,
                  timezone: booking.founderTimezone,
                  provider: booking.meetingProvider,
                }
              : null,
          source:
            key === 'visuals' || key === 'branding'
              ? 'Founder upload and approval'
              : key === 'interview'
                ? 'Scheduling provider'
                : 'Founder saved',
          reason: rejectionReason(item?.rejections ?? []),
        };
      })
    : null;

  const fee = optionalWorkspace?.fee ?? null;
  const listingFee = fee
    ? {
        status: fee.locked ? 'Paid' : 'Calculated',
        calculatedAt: fee.calculatedAt,
        baseCents: fee.baseCents,
        lines: OPTIONAL_ITEM_KEYS.map((key) => ({
          key,
          label: key[0]!.toUpperCase() + key.slice(1),
          amountCents: fee.itemDiscountCents,
          qualifies: itemByKey.get(key)?.complete ?? false,
        })),
        subtotalCents: fee.subtotalCents,
        savedCents: fee.discountCents,
        minSubtotalCents: fee.minSubtotalCents,
        taxCents: null,
        totalCents: null,
        paid: fee.locked,
        paidAt: campaign?.listingPaidAt?.toISOString() ?? null,
        transactionId: null,
        nextLabel: fee.locked ? 'Matching' : 'Founder completes checkout',
      }
    : null;

  return {
    prospectId,
    campaignId,
    workflow: {
      stage,
      stageLabel: stage ? FOUNDER_WORKFLOW_LABELS[stage] : null,
      stageReached,
      stageReachedLabel: FOUNDER_WORKFLOW_LABELS[stageReached],
      exitStatus,
      stages,
    },
    applicationReview,
    applicationReviewRequirement,
    applicationRounds: reviewRows.length,
    offers: offerRows.map(toOfferView),
    finalCampaignSends: sendRows.map((row) => ({
      id: row.id,
      associationId: row.associationId,
      sentAt: row.sentAt.toISOString(),
      sentBy: row.sentBy,
      openedAt: iso(row.openedAt),
      notificationId: row.notificationId,
    })),
    notes: noteRows.map((row) => ({
      id: row.id,
      body: row.body,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
    })),
    warnings: warningRows.map((row) => ({
      id: row.id,
      reason: row.reason,
      warnedBy: row.warnedBy,
      createdAt: row.createdAt.toISOString(),
    })),
    invitePrefills,
    identity: {
      username: ctx.claim?.username ?? ctx.prospect.username ?? null,
      usernameSupplier: ctx.claim?.usernameSupplier ?? null,
      emailCodeVerifiedAt: iso(ctx.claim?.emailCodeVerifiedAt ?? null),
      passwordSetAt,
      lastActiveAt: iso(ctx.prospect.lastActiveAt),
    },
    versions: {
      draftVersion: buildRow?.draftVersion ?? null,
      publishedVersion: snapshotRow?.publishedVersion ?? null,
    },
    recentFieldEdits: editRows.map(toFieldEditView),
    optionalItems,
    listingFee,
  };
}

function toOfferView(row: typeof associationAdminOffers.$inferSelect): AdminOfferView {
  return {
    id: row.id,
    associationId: row.associationId,
    offerBasisPoints: row.offerBasisPoints,
    offeredBy: row.offeredBy,
    internalReason: row.internalReason,
    offeredAt: row.offeredAt.toISOString(),
    supersededAt: iso(row.supersededAt),
    withdrawnAt: iso(row.withdrawnAt),
    withdrawnReason: row.withdrawnReason,
    live: row.supersededAt === null && row.withdrawnAt === null,
  };
}

function toFieldEditView(row: typeof campaignAdminFieldEdits.$inferSelect): FieldEditView {
  const resolved = resolveSetupField(row.fieldKey);
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    fieldLabel: resolved?.definition.label ?? null,
    fieldGroup: resolved ? SETUP_FIELD_GROUP_LABELS[resolved.definition.group] : null,
    priorValue: row.priorValue,
    newValue: row.newValue,
    internalReason: row.internalReason,
    materiality: row.materiality,
    actor: row.actor,
    editedAt: row.editedAt.toISOString(),
  };
}

/**
 * When the Founder chose their password.
 *
 * There is no column, and §33.1.8's scan is why one may not be added — the fact
 * lives in `audit_events` and nowhere else (`vetting/claim.ts` writes it with
 * `targetType: 'campaign'`). This is the read path the reference's
 * `Password · <time>` row needs, and it is a PROJECTION: it adds no state, and
 * a deployment with no such event renders absence rather than a claim.
 *
 * Filtered in SQL, not in JS — `founder.password_set` is written once per
 * Founder across the whole platform, so a scan-then-find would grow with every
 * Founder ever onboarded.
 */
async function readPasswordSetAt(db: Database, campaignIds: string[]): Promise<string | null> {
  const [row] = await db
    .select({ occurredAt: auditEvents.occurredAt })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, 'founder.password_set'),
        eq(auditEvents.targetType, 'campaign'),
        inArray(auditEvents.targetId, campaignIds),
      ),
    )
    .orderBy(auditEvents.occurredAt)
    .limit(1);
  return row ? row.occurredAt.toISOString() : null;
}

/* ══ 2. Internal notes ═════════════════════════════════════════════════════ */

/**
 * Adds one Founder-scoped note.
 *
 * Insert-only — migration 0059 revokes UPDATE and DELETE from the app role, so
 * a correction is a new note. The author comes from the guarded session; a
 * request that could declare its own provenance could declare a flattering one.
 */
export async function addInternalNote(
  db: Database,
  who: PanelActor,
  input: { prospectId: string; body: string },
): Promise<{ ok: true; note: InternalNoteView } | PanelRefusal> {
  const body = input.body.trim();
  if (!body) {
    return refuse(
      'empty_note',
      'A note needs something written in it.',
      'Nothing was saved, and nothing you typed was lost.',
    );
  }
  if (!looksLikeId(input.prospectId)) {
    return refuse('not_found', 'There is no Founder at that address.', 'Go back to the Founders list.');
  }

  const [exists] = await db
    .select({ id: founderProspects.id })
    .from(founderProspects)
    .where(eq(founderProspects.id, input.prospectId))
    .limit(1);
  if (!exists) {
    return refuse('not_found', 'There is no Founder at that address.', 'Go back to the Founders list.');
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(founderInternalNotes)
      .values({ prospectId: input.prospectId, body: body.slice(0, 20000), author: who.actor })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'founder.internal_note_added',
      targetType: 'founder_prospect',
      targetId: input.prospectId,
      internalReason: 'Admin recorded a Founder-scoped internal note.',
      // §26.8: an internal note's body never reaches a timeline, because a
      // timeline is exactly the view that gets pasted into a customer message.
      // The event records that a note exists, not what it says.
      newValue: { noteId: inserted!.id },
    });
    return inserted!;
  });

  return {
    ok: true,
    note: {
      id: row.id,
      body: row.body,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

/* ══ 3. Invite prefills ════════════════════════════════════════════════════ */

/**
 * Adds one durable warning to the Founder account.
 *
 * Warnings are append-only: an Admin cannot quietly lower the count or rewrite
 * the reason later. The route is freshness-gated because this is an account
 * enforcement signal, even though it does not by itself suspend access.
 */
export async function addAccountWarning(
  db: Database,
  who: PanelActor,
  input: { prospectId: string; reason: string },
): Promise<{ ok: true; warning: AccountWarningView } | PanelRefusal> {
  const reason = input.reason.trim();
  if (!reason) {
    return refuse(
      'empty_reason',
      'An account warning needs a recorded reason.',
      'Nothing was saved. Add the evidence or behaviour that caused this warning.',
    );
  }
  if (!looksLikeId(input.prospectId)) {
    return refuse('not_found', 'There is no Founder at that address.', 'Go back to the Founders list.');
  }

  const [exists] = await db
    .select({ id: founderProspects.id })
    .from(founderProspects)
    .where(eq(founderProspects.id, input.prospectId))
    .limit(1);
  if (!exists) {
    return refuse('not_found', 'There is no Founder at that address.', 'Go back to the Founders list.');
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(founderAccountWarnings)
      .values({
        prospectId: input.prospectId,
        reason: reason.slice(0, 20000),
        warnedBy: who.actor,
      })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'founder.account_warning_added',
      targetType: 'founder_prospect',
      targetId: input.prospectId,
      internalReason: reason.slice(0, 20000),
      newValue: { warningId: inserted!.id },
    });
    return inserted!;
  });

  return {
    ok: true,
    warning: {
      id: row.id,
      reason: row.reason,
      warnedBy: row.warnedBy,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export interface PrefillPatch {
  viewsCount?: number | null;
  affiliateMatches?: number | null;
  affiliateType?: string | null;
  brandVoice1?: string | null;
  brandVoice2?: string | null;
  username?: string | null;
}

/**
 * Writes the Invite stage's prefills onto one draft.
 *
 * §9's autosave rule, applied here: a key ABSENT from the patch writes nothing,
 * and a key present as `null` clears. Three answers, not two — a failed save
 * never clears valid fields, and a field nobody touched is not a field somebody
 * blanked.
 *
 * `username` is the one key that does not live on the draft: it is the person's
 * identifier, so it lands on `founder_prospects` (and on the claim profile's
 * prefill quartet when a claim exists and the Founder has not edited it —
 * overwriting a Founder's own edit with an Admin prefill would silently rewrite
 * their record).
 */
export async function updateInvitePrefills(
  db: Database,
  who: PanelActor,
  input: { draftId: string; patch: PrefillPatch },
): Promise<{ ok: true; prefills: InvitePrefillView } | PanelRefusal> {
  if (!looksLikeId(input.draftId)) {
    return refuse('not_found', 'There is no invitation at that address.', 'Go back to the Founder record.');
  }

  const patch = input.patch;

  if (patch.affiliateType !== undefined && patch.affiliateType !== null) {
    if (!PREFILL_AFFILIATE_TYPE_IDS.includes(patch.affiliateType)) {
      return refuse(
        'unknown_affiliate_type',
        'That is not one of the nine affiliate types this invitation can name.',
        'Choose one from the list. Nothing you entered was lost.',
      );
    }
  }
  for (const [key, label] of [
    ['viewsCount', 'number of views'],
    ['affiliateMatches', 'number of affiliate matches'],
  ] as const) {
    const value = patch[key];
    if (value !== undefined && value !== null) {
      if (!Number.isInteger(value) || value < 0) {
        return refuse(
          'invalid_count',
          `The ${label} must be a whole number that is not negative.`,
          'Nothing you entered was lost.',
        );
      }
    }
  }

  const draftSet: Record<string, unknown> = {};
  if (patch.viewsCount !== undefined) draftSet['prefillViewsCount'] = patch.viewsCount;
  if (patch.affiliateMatches !== undefined) {
    draftSet['prefillAffiliateMatches'] = patch.affiliateMatches;
  }
  if (patch.affiliateType !== undefined) draftSet['prefillAffiliateType'] = patch.affiliateType;
  if (patch.brandVoice1 !== undefined) {
    draftSet['prefillBrandVoice1'] = trimToNull(patch.brandVoice1, 500);
  }
  if (patch.brandVoice2 !== undefined) {
    draftSet['prefillBrandVoice2'] = trimToNull(patch.brandVoice2, 500);
  }

  const result = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, input.draftId))
      .for('update');
    if (!draft) return null;

    const prior = {
      viewsCount: draft.prefillViewsCount,
      affiliateMatches: draft.prefillAffiliateMatches,
      affiliateType: draft.prefillAffiliateType,
      brandVoice1: draft.prefillBrandVoice1,
      brandVoice2: draft.prefillBrandVoice2,
      username: null as string | null,
    };

    let updated = draft;
    if (Object.keys(draftSet).length > 0) {
      draftSet['updatedAt'] = new Date();
      const [row] = await tx
        .update(campaignDrafts)
        .set(draftSet)
        .where(eq(campaignDrafts.id, input.draftId))
        .returning();
      updated = row ?? draft;
    }

    if (patch.username !== undefined) {
      const [prospect] = await tx
        .select()
        .from(founderProspects)
        .where(eq(founderProspects.id, draft.prospectId))
        .for('update');
      prior.username = prospect?.username ?? null;

      const username = trimToNull(patch.username, 200);
      await tx
        .update(founderProspects)
        .set({ username, updatedAt: new Date() })
        .where(eq(founderProspects.id, draft.prospectId));

      // The claim profile's quartet mirrors the prefill so the onboarding
      // surface can show what Proovd supplied beside what the Founder typed.
      // A Founder edit wins: `username_supplier = 'founder'` means they own it.
      const [claim] = await tx
        .select()
        .from(founderClaimProfiles)
        .where(eq(founderClaimProfiles.draftId, draft.id))
        .for('update');
      if (claim && claim.usernameSupplier !== 'founder') {
        await tx
          .update(founderClaimProfiles)
          .set({
            username,
            usernamePrefilled: username,
            usernameSupplier: 'proovd',
            updatedAt: new Date(),
          })
          .where(eq(founderClaimProfiles.id, claim.id));
      } else if (claim) {
        await tx
          .update(founderClaimProfiles)
          .set({ usernamePrefilled: username, updatedAt: new Date() })
          .where(eq(founderClaimProfiles.id, claim.id));
      }
    }

    await insertAuditEvent(tx, who, {
      action: 'founder.invite_prefills_updated',
      targetType: 'campaign_draft',
      targetId: draft.id,
      internalReason: `Admin updated the invitation prefills: ${Object.keys(patch).join(', ') || 'no keys'}.`,
      priorValue: prior,
      newValue: {
        viewsCount: updated.prefillViewsCount,
        affiliateMatches: updated.prefillAffiliateMatches,
        affiliateType: updated.prefillAffiliateType,
        brandVoice1: updated.prefillBrandVoice1,
        brandVoice2: updated.prefillBrandVoice2,
        ...(patch.username !== undefined ? { username: trimToNull(patch.username, 200) } : {}),
      },
    });

    return updated;
  });

  if (!result) {
    return refuse('not_found', 'There is no invitation at that address.', 'Go back to the Founder record.');
  }

  return {
    ok: true,
    prefills: {
      draftId: result.id,
      viewsCount: result.prefillViewsCount,
      affiliateMatches: result.prefillAffiliateMatches,
      affiliateType: result.prefillAffiliateType,
      affiliateTypeLabel: prefillAffiliateTypeLabel(result.prefillAffiliateType),
      brandVoice1: result.prefillBrandVoice1,
      brandVoice2: result.prefillBrandVoice2,
      updatedAt: result.updatedAt.toISOString(),
    },
  };
}

function trimToNull(value: string | null | undefined, limit: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, limit);
}

/* ══ 4–6. Application review ═══════════════════════════════════════════════ */

async function lockCampaign(
  tx: Tx,
  campaignId: string,
): Promise<typeof campaigns.$inferSelect | null> {
  const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for('update');
  return row ?? null;
}

export interface AccountWarningView {
  id: string;
  reason: string;
  warnedBy: string;
  createdAt: string;
}

/** Ensures the mandatory early Application Review gate is on for a campaign. */
export async function setApplicationReviewRequirement(
  db: Database,
  who: PanelActor,
  input: { campaignId: string; required: boolean; internalReason: string },
): Promise<
  | {
      ok: true;
      requirement: { required: boolean; locked: false; lockedReason: null };
      changed: boolean;
    }
  | PanelRefusal
> {
  if (!looksLikeId(input.campaignId)) {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (!input.required) {
    return refuse(
      'review_required',
      'Application Review is required for every campaign and cannot be skipped.',
      'Continue with Application Review. Nothing has changed.',
    );
  }
  const internalReason = input.internalReason.trim();
  if (!internalReason) {
    return refuse(
      'reason_required',
      'A reason is required to change whether Application Review blocks this campaign.',
      'Add the reason and try again. Nothing has changed.',
    );
  }

  const result = await db.transaction(async (tx) => {
    const campaign = await lockCampaign(tx, input.campaignId);
    if (!campaign) return 'not_found' as const;

    const [review] = await tx
      .select({ id: campaignApplicationReviews.id })
      .from(campaignApplicationReviews)
      .where(eq(campaignApplicationReviews.campaignId, input.campaignId))
      .limit(1);
    if (review) return 'review_started' as const;
    if (
      !['invited_draft', 'vetting_submitted', 'account_claimed'].includes(campaign.status) ||
      workflowStageIndex(
        isFounderWorkflowStage(campaign.workflowStageReached)
          ? campaign.workflowStageReached
          : 'invite',
      ) > workflowStageIndex('onboarding')
    ) {
      return 'progressed' as const;
    }
    if (campaign.applicationReviewRequired === input.required) {
      return { changed: false as const };
    }

    await tx
      .update(campaigns)
      .set({ applicationReviewRequired: input.required })
      .where(eq(campaigns.id, input.campaignId));
    await insertAuditEvent(tx, who, {
      action: 'campaign.application_review_requirement_changed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason,
      priorValue: { applicationReviewRequired: campaign.applicationReviewRequired },
      newValue: { applicationReviewRequired: input.required },
    });
    return { changed: true as const };
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (result === 'review_started') {
    return refuse(
      'review_started',
      'Application Review has already started, so its requirement is locked.',
      'Finish the current review. Nothing has changed.',
    );
  }
  if (result === 'progressed') {
    return refuse(
      'campaign_progressed',
      'This campaign has already entered payment or a later stage.',
      'Application Review cannot be inserted or removed now. Nothing has changed.',
    );
  }
  return {
    ok: true,
    requirement: { required: input.required, locked: false, lockedReason: null },
    changed: result.changed,
  };
}

/**
 * Opens a round, or returns the one already open.
 *
 * Idempotent by design: the reference's `Open below` is a navigation control an
 * Admin can hit twice, and a second round opened by a double click would move
 * `Application version` for no reason. The unique index on
 * `(campaign_id, round)` is what actually makes the second attempt safe.
 */
export async function openApplicationReview(
  db: Database,
  who: PanelActor,
  input: { campaignId: string },
): Promise<{ ok: true; review: ApplicationReviewView; opened: boolean } | PanelRefusal> {
  if (!looksLikeId(input.campaignId)) {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }

  const outcome = await db.transaction(async (tx) => {
    const campaign = await lockCampaign(tx, input.campaignId);
    if (!campaign) return 'not_found' as const;

    const [latest] = await tx
      .select()
      .from(campaignApplicationReviews)
      .where(eq(campaignApplicationReviews.campaignId, input.campaignId))
      .orderBy(desc(campaignApplicationReviews.round))
      .limit(1);

    if (latest && !applicationReviewDecided(latest.outcome)) {
      return { review: latest, opened: false };
    }

    const round = (latest?.round ?? 0) + 1;
    const [inserted] = await tx
      .insert(campaignApplicationReviews)
      .values({
        campaignId: input.campaignId,
        round,
        // A round opens `waiting`, which is the reference's default and the
        // honest one: nobody has looked yet.
        outcome: 'waiting',
      })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'campaign.application_review_opened',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `Application review round ${round} opened. §9 defines no lifecycle state for this decision, so it is recorded on its own round rather than on campaigns.status.`,
      newValue: { round, outcome: 'waiting' },
    });

    return { review: inserted!, opened: true };
  });

  if (outcome === 'not_found') {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }

  return {
    ok: true,
    opened: outcome.opened,
    review: await hydrateReview(db, outcome.review),
  };
}

/**
 * Records the decision on the open round.
 *
 * The internal reason and the customer explanation are separate columns because
 * §25.6 keeps them separate: internal vocabulary must not leak (§3.1), and a
 * single field would make the two the same sentence sooner or later.
 *
 * `campaigns.status` is NOT moved. §23.1 makes it lifecycle-only, and
 * `pending_review` / `changes_required` / `approved` already belong to the §15
 * BUILD review — a different decision later in the flow. Writing one of them
 * here would make two decisions share one column.
 */
export async function decideApplicationReview(
  db: Database,
  who: PanelActor,
  input: {
    campaignId: string;
    outcome: string;
    internalReason: string;
    customerExplanation?: string | null;
  },
): Promise<{ ok: true; review: ApplicationReviewView } | PanelRefusal> {
  if (!looksLikeId(input.campaignId)) {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (!isApplicationReviewOutcome(input.outcome)) {
    return refuse(
      'unknown_outcome',
      `That is not one of the ${APPLICATION_REVIEW_OUTCOMES.length} recorded application-review outcomes.`,
      'Choose one of the recorded outcomes. Nothing has changed.',
    );
  }
  const internalReason = input.internalReason.trim();
  if (!internalReason) {
    return refuse(
      'reason_required',
      'A reason is required.',
      'The reason is saved to History and shown to the Founder when applicable. Nothing has changed.',
    );
  }

  const outcome: ApplicationReviewOutcome = input.outcome;

  const result = await db.transaction(async (tx) => {
    const campaign = await lockCampaign(tx, input.campaignId);
    if (!campaign) return 'not_found' as const;

    const [open] = await tx
      .select()
      .from(campaignApplicationReviews)
      .where(eq(campaignApplicationReviews.campaignId, input.campaignId))
      .orderBy(desc(campaignApplicationReviews.round))
      .limit(1)
      .for('update');

    if (!open) return 'no_round' as const;
    if (applicationReviewDecided(open.outcome)) return 'already_decided' as const;

    const decided = applicationReviewDecided(outcome);
    const [updated] = await tx
      .update(campaignApplicationReviews)
      .set({
        outcome,
        reviewer: who.actor,
        internalReason,
        customerExplanation: input.customerExplanation?.trim() || null,
        // A round that has not reached a terminal outcome is still open, so it
        // carries no decision time — `decided_at` means decided, not touched.
        decidedAt: decided ? new Date() : null,
      })
      .where(eq(campaignApplicationReviews.id, open.id))
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'campaign.application_review_decided',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason,
      customerExplanation: input.customerExplanation?.trim() || null,
      priorValue: { round: open.round, outcome: open.outcome },
      newValue: { round: open.round, outcome },
    });

    if (outcome === 'approved') {
      await tx
        .update(campaigns)
        .set({ workflowStageReached: 'fee' })
        .where(eq(campaigns.id, input.campaignId));
    }

    return updated!;
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (result === 'no_round') {
    return refuse(
      'no_open_round',
      'There is no open application review to decide.',
      'Open a review round first. Nothing has changed.',
    );
  }
  if (result === 'already_decided') {
    return refuse(
      'already_decided',
      'That review round already carries a decision.',
      'A further decision opens a new round. Nothing has changed.',
    );
  }

  return { ok: true, review: await hydrateReview(db, result) };
}

/**
 * Sends one named field back to the Founder.
 *
 * One field, one reason, and the round stays OPEN — the existing §15 route
 * takes an array and closes its round, which is a different act. The field key
 * comes from `APPLICATION_FIELDS`, never free text: a request against a field
 * that does not exist would look complete while pointing at nothing.
 *
 * A second request for the same field on the same round is refused by the
 * partial unique index rather than by a service rule, which is the posture this
 * codebase takes everywhere: illegal states are impossible, not merely
 * unwritten.
 */
export async function requestApplicationChange(
  db: Database,
  who: PanelActor,
  input: { campaignId: string; fieldKey: string; reason: string },
): Promise<
  | { ok: true; review: ApplicationReviewView; requestId: string }
  | PanelRefusal
> {
  if (!looksLikeId(input.campaignId)) {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  const field = applicationFieldByKey(input.fieldKey);
  if (!field) {
    return refuse(
      'unknown_field',
      'That is not a field on the application.',
      'Pick one of the rows on this stage. Nothing has changed.',
    );
  }
  const reason = input.reason.trim();
  if (!reason) {
    return refuse(
      'reason_required',
      'A reason is required.',
      'This reason is shown to the Founder when applicable and saved to History. Nothing has changed.',
    );
  }

  const result = await db.transaction(async (tx) => {
    const campaign = await lockCampaign(tx, input.campaignId);
    if (!campaign) return 'not_found' as const;

    const [open] = await tx
      .select()
      .from(campaignApplicationReviews)
      .where(eq(campaignApplicationReviews.campaignId, input.campaignId))
      .orderBy(desc(campaignApplicationReviews.round))
      .limit(1)
      .for('update');
    if (!open) return 'no_round' as const;
    if (applicationReviewDecided(open.outcome)) return 'already_decided' as const;

    const [existing] = await tx
      .select({ id: campaignApplicationChangeRequests.id })
      .from(campaignApplicationChangeRequests)
      .where(
        and(
          eq(campaignApplicationChangeRequests.reviewId, open.id),
          eq(campaignApplicationChangeRequests.fieldKey, field.key),
          isNull(campaignApplicationChangeRequests.resolvedAt),
        ),
      )
      .limit(1);
    if (existing) return 'already_open' as const;

    const [inserted] = await tx
      .insert(campaignApplicationChangeRequests)
      .values({
        reviewId: open.id,
        campaignId: input.campaignId,
        fieldKey: field.key,
        reason: reason.slice(0, 20000),
        requestedBy: who.actor,
      })
      .returning();

    const [updatedReview] = await tx
      .update(campaignApplicationReviews)
      .set({
        outcome: 'changes_requested',
        reviewer: who.actor,
        decidedAt: new Date(),
        customerExplanation: reason.slice(0, 20000),
      })
      .where(eq(campaignApplicationReviews.id, open.id))
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'campaign.application_change_requested',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `Change requested against ${field.label} on application review round ${open.round}.`,
      customerExplanation: reason,
      newValue: { round: open.round, fieldKey: field.key, requestId: inserted!.id },
    });

    return { review: updatedReview!, requestId: inserted!.id };
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (result === 'no_round') {
    return refuse(
      'no_open_round',
      'There is no open application review to attach this to.',
      'Open a review round first. Nothing has changed.',
    );
  }
  if (result === 'already_decided') {
    return refuse(
      'already_decided',
      'That review round already carries a decision, so it takes no further requests.',
      'Open a new round first. Nothing has changed.',
    );
  }
  if (result === 'already_open') {
    return refuse(
      'already_open',
      'There is already an open change request for that field on this round.',
      'Resolve the open one first. Nothing has changed.',
    );
  }

  return {
    ok: true,
    requestId: result.requestId,
    review: await hydrateReview(db, result.review),
  };
}

async function hydrateReview(
  db: Database,
  row: typeof campaignApplicationReviews.$inferSelect,
): Promise<ApplicationReviewView> {
  const requests = await db
    .select()
    .from(campaignApplicationChangeRequests)
    .where(eq(campaignApplicationChangeRequests.reviewId, row.id))
    .orderBy(desc(campaignApplicationChangeRequests.requestedAt));

  return {
    id: row.id,
    round: row.round,
    outcome: row.outcome,
    outcomeLabel: applicationReviewLabel(row.outcome),
    decided: applicationReviewDecided(row.outcome),
    reviewer: row.reviewer,
    decidedAt: iso(row.decidedAt),
    internalReason: row.internalReason,
    customerExplanation: row.customerExplanation,
    openedAt: row.openedAt.toISOString(),
    changeRequests: requests.map((r) => ({
      id: r.id,
      fieldKey: r.fieldKey,
      fieldLabel: applicationFieldByKey(r.fieldKey)?.label ?? null,
      reason: r.reason,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt.toISOString(),
      resolvedAt: iso(r.resolvedAt),
    })),
  };
}

/* ══ 7–9. Matching: offers and the final campaign ══════════════════════════ */

export const OFFER_MIN_BASIS_POINTS = 10;
export const OFFER_MAX_BASIS_POINTS = 5000;

async function lockAssociation(
  tx: Tx,
  campaignId: string,
  associationId: string,
): Promise<typeof campaignAffiliateAssociations.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(campaignAffiliateAssociations)
    .where(
      and(
        eq(campaignAffiliateAssociations.id, associationId),
        eq(campaignAffiliateAssociations.campaignId, campaignId),
      ),
    )
    .for('update');
  return row ?? null;
}

/**
 * Records an Admin offer against one association.
 *
 * Basis points, not percent: the reference's control is `step="0.1"`, every
 * percent column in the money tree is an `integer`, and `shared/money` has a
 * one-implementation rule a decimal column would quietly fork. 3250 is 32.5%.
 *
 * A revision SUPERSEDES in the same transaction and inserts a new row; it never
 * UPDATEs the old one. Migration 0059 grants UPDATE on exactly
 * `superseded_at`/`withdrawn_at`/`withdrawn_reason` and revokes it everywhere
 * else, so a rewritten amount is impossible rather than merely unwritten.
 *
 * It writes NO `proposal_versions` row and moves NO association status. §14.2's
 * acceptance stays bilateral and stays with the Founder.
 */
export async function recordAdminOffer(
  db: Database,
  who: PanelActor,
  input: {
    campaignId: string;
    associationId: string;
    offerBasisPoints: number;
    internalReason: string;
  },
): Promise<{ ok: true; offer: AdminOfferView; superseded: string | null } | PanelRefusal> {
  if (!looksLikeId(input.campaignId) || !looksLikeId(input.associationId)) {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }
  if (
    !Number.isInteger(input.offerBasisPoints) ||
    input.offerBasisPoints < OFFER_MIN_BASIS_POINTS ||
    input.offerBasisPoints > OFFER_MAX_BASIS_POINTS
  ) {
    return refuse(
      'out_of_range',
      'An offer is recorded in basis points between 10 and 5000 — 0.1% to 50%.',
      'Nothing you entered was lost.',
    );
  }
  const internalReason = input.internalReason.trim();
  if (!internalReason) {
    return refuse(
      'reason_required',
      'A reason is required.',
      'The reason is saved to History. Nothing has changed.',
    );
  }

  const result = await db.transaction(async (tx) => {
    const association = await lockAssociation(tx, input.campaignId, input.associationId);
    if (!association) return 'not_found' as const;

    const [live] = await tx
      .select()
      .from(associationAdminOffers)
      .where(
        and(
          eq(associationAdminOffers.associationId, input.associationId),
          isNull(associationAdminOffers.supersededAt),
          isNull(associationAdminOffers.withdrawnAt),
        ),
      )
      .for('update');

    const now = new Date();
    if (live) {
      await tx
        .update(associationAdminOffers)
        .set({ supersededAt: now })
        .where(eq(associationAdminOffers.id, live.id));
    }

    const [inserted] = await tx
      .insert(associationAdminOffers)
      .values({
        associationId: input.associationId,
        campaignId: input.campaignId,
        offerBasisPoints: input.offerBasisPoints,
        offeredBy: who.actor,
        internalReason: internalReason.slice(0, 20000),
      })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'association.admin_offer_recorded',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason,
      // The prior value is read from the superseded row under lock, in this
      // transaction. No caller supplies it.
      priorValue: live ? { offerBasisPoints: live.offerBasisPoints, offerId: live.id } : null,
      newValue: { offerBasisPoints: input.offerBasisPoints, offerId: inserted!.id },
      evidenceLinks: { campaignId: input.campaignId },
    });

    return { offer: inserted!, superseded: live?.id ?? null };
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }
  return { ok: true, offer: toOfferView(result.offer), superseded: result.superseded };
}

/**
 * Withdraws the live offer.
 *
 * Deliberately NOT routed through §29 enforcement: withdrawing an offer is not
 * a sanction, and the enforcement path requires seven inputs that describe one.
 * The CHECK on the table refuses a withdrawal with no reason, so the reason is
 * a database fact rather than a service habit.
 */
export async function withdrawAdminOffer(
  db: Database,
  who: PanelActor,
  input: { campaignId: string; associationId: string; reason: string },
): Promise<{ ok: true; offer: AdminOfferView } | PanelRefusal> {
  if (!looksLikeId(input.campaignId) || !looksLikeId(input.associationId)) {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }
  const reason = input.reason.trim();
  if (!reason) {
    return refuse(
      'reason_required',
      'A reason is required.',
      'This reason is saved to History. Nothing has changed.',
    );
  }

  const result = await db.transaction(async (tx) => {
    const association = await lockAssociation(tx, input.campaignId, input.associationId);
    if (!association) return 'not_found' as const;

    const [live] = await tx
      .select()
      .from(associationAdminOffers)
      .where(
        and(
          eq(associationAdminOffers.associationId, input.associationId),
          isNull(associationAdminOffers.supersededAt),
          isNull(associationAdminOffers.withdrawnAt),
        ),
      )
      .for('update');
    if (!live) return 'no_live_offer' as const;

    const [updated] = await tx
      .update(associationAdminOffers)
      .set({ withdrawnAt: new Date(), withdrawnReason: reason.slice(0, 20000) })
      .where(eq(associationAdminOffers.id, live.id))
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'association.admin_offer_withdrawn',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason: reason,
      priorValue: { offerBasisPoints: live.offerBasisPoints, offerId: live.id, live: true },
      newValue: { offerId: live.id, live: false },
      evidenceLinks: { campaignId: input.campaignId },
    });

    return updated!;
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }
  if (result === 'no_live_offer') {
    return refuse(
      'no_live_offer',
      'There is no live offer on that Creator to withdraw.',
      'Nothing has changed.',
    );
  }
  return { ok: true, offer: toOfferView(result) };
}

/**
 * Records that the final campaign was sent to one Creator.
 *
 * Append-only: a resend is a new row, because the reference renders a history
 * and a table that overwrote the previous send could not show it.
 *
 * `notification_id` is left NULL and is a STATE, not missing data — "recorded,
 * not confirmed delivered" (§27.2). The panel has no sender wired to it, and a
 * key with no sender claims a message that does not exist (§1.4), so this
 * function records the act and makes no claim about an inbox.
 */
export async function recordFinalCampaignSend(
  db: Database,
  who: PanelActor,
  input: { campaignId: string; associationId: string },
): Promise<{ ok: true; send: FinalCampaignSendView } | PanelRefusal> {
  if (!looksLikeId(input.campaignId) || !looksLikeId(input.associationId)) {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }

  const result = await db.transaction(async (tx) => {
    const association = await lockAssociation(tx, input.campaignId, input.associationId);
    if (!association) return 'not_found' as const;

    const [inserted] = await tx
      .insert(associationFinalCampaignSends)
      .values({
        associationId: input.associationId,
        campaignId: input.campaignId,
        sentBy: who.actor,
      })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'association.final_campaign_recorded',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason:
        'Admin recorded that the final campaign was sent to this Creator. The row carries no notification id: nothing here confirms delivery.',
      newValue: { sendId: inserted!.id, notificationConfirmed: false },
      evidenceLinks: { campaignId: input.campaignId },
    });

    return inserted!;
  });

  if (result === 'not_found') {
    return refuse('not_found', 'There is no Creator at that address on this campaign.', 'Go back to Matching.');
  }

  return {
    ok: true,
    send: {
      id: result.id,
      associationId: result.associationId,
      sentAt: result.sentAt.toISOString(),
      sentBy: result.sentBy,
      openedAt: iso(result.openedAt),
      notificationId: result.notificationId,
    },
  };
}

/* ══ 10. Affiliate candidates ══════════════════════════════════════════════ */

export interface AffiliateCandidateView {
  prospectId: string;
  legalName: string | null;
  publicHandle: string | null;
  email: string | null;
  subtype: string | null;
  audienceNiche: string | null;
  audienceSize: string | null;
  qualityTier: string | null;
  verificationStatus: string;
  claimed: boolean;
  /** True when this campaign already has an association for this prospect. */
  alreadyAdded: boolean;
  associationId: string | null;
  associationStatus: string | null;
}

/**
 * Every recruitable Creator, with whether this campaign already has them.
 *
 * The join is on BOTH id columns on purpose. `campaign_affiliate_associations`
 * carries `prospect_id` (set by every row Phase 08 creates) and `affiliate_id`
 * (an unreferenced uuid that predates the prospect concept and, per the
 * long-standing note, holds the PROSPECT id rather than an account id). Joining
 * on one of them would silently show "not added" for rows written through the
 * other, and the consequence of that mistake here is adding a second
 * association for a Creator who already has one.
 */
export async function listAffiliateCandidates(
  db: Database,
  campaignId: string,
): Promise<AffiliateCandidateView[] | null> {
  if (!looksLikeId(campaignId)) return null;

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const rows = await db
    .select({
      prospect: affiliateProspects,
      associationId: campaignAffiliateAssociations.id,
      associationStatus: campaignAffiliateAssociations.status,
    })
    .from(affiliateProspects)
    .leftJoin(
      campaignAffiliateAssociations,
      and(
        eq(campaignAffiliateAssociations.campaignId, campaignId),
        or(
          eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
          eq(campaignAffiliateAssociations.affiliateId, affiliateProspects.id),
        ),
      ),
    )
    .orderBy(affiliateProspects.createdAt);

  return rows.map((row) => ({
    prospectId: row.prospect.id,
    legalName: row.prospect.legalName,
    publicHandle: row.prospect.publicHandle,
    email: row.prospect.email,
    subtype: row.prospect.subtype,
    audienceNiche: row.prospect.audienceNiche,
    audienceSize: row.prospect.audienceSize,
    qualityTier: row.prospect.qualityTier,
    verificationStatus: row.prospect.verificationStatus,
    claimed: row.prospect.claimedUserId !== null,
    alreadyAdded: row.associationId !== null,
    associationId: row.associationId,
    associationStatus: row.associationStatus,
  }));
}

/* ══ 11. The setup field edit ══════════════════════════════════════════════ */

export interface SetupEditResult {
  ok: true;
  fieldKey: string;
  label: string;
  priorValue: string | null;
  newValue: string | null;
  materiality: string;
  draftVersion: number;
  editId: string;
}

/**
 * Changes one saved campaign value directly, and records it.
 *
 * ── Why this does not call `saveBuild` / `upsertFaq` / `upsertRewardPackage` ─
 * All three refuse outside `['affiliate_response_and_build', 'changes_required']`
 * — and Campaign setup IS the review stage, so every one of them would refuse
 * the edit this route exists to make. All three also take a WHOLE row: a
 * one-field title edit through the reward writer blanks sku, contents,
 * fulfilment commitment and delivery, which is a defect this codebase has
 * already recorded. And each opens its own transaction, which would put the
 * prior read and the write in different transactions — exactly what §33.12.4
 * forbids. What IS reused is `recomputeBuildStatus`, the one existing writer
 * that fits, called after the commit so the derived §23.2 status stays right.
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 * Before launch, any registered, non-refused field may be changed. Once
 * `campaign_live_at` is set — the ANCHOR gates, never a sweep or a status
 * string — §20's live-editing register decides, and only `direct_versioned`
 * fields pass. Everything else is refused with §20's own reason, because the
 * reacceptance machinery §15 demands takes a classification and an
 * affected-Creator list this dialog collects neither of, and inventing that
 * list would be §1 rule 6.
 */
export async function editSetupField(
  db: Database,
  who: PanelActor,
  input: {
    campaignId: string;
    fieldKey: string;
    value: unknown;
    internalReason: string;
  },
): Promise<SetupEditResult | PanelRefusal> {
  if (!looksLikeId(input.campaignId)) {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }

  const resolved = resolveSetupField(input.fieldKey);
  if (!resolved) {
    return refuse(
      'unknown_field',
      'That is not a field this panel can change.',
      'Pick one of the rows on this stage. Nothing has changed.',
    );
  }
  const { definition, rowId } = resolved;

  if (definition.refusal) {
    return refuse('field_not_editable', definition.refusal, 'Nothing has changed.');
  }
  if (!definition.table || !definition.column) {
    return refuse(
      'field_not_editable',
      `${definition.label} has no column this route may write.`,
      'Nothing has changed.',
    );
  }

  const internalReason = input.internalReason.trim();
  if (!internalReason) {
    return refuse(
      'reason_required',
      'A reason is required.',
      'The edit is recorded in History with its reason. Nothing has changed.',
    );
  }

  const coerced = coerceSetupValue(definition, input.value);
  if (!coerced.ok) {
    return refuse('invalid_value', coerced.message, 'Nothing you entered was lost.');
  }

  const outcome = await db.transaction(async (tx) => {
    const campaign = await lockCampaign(tx, input.campaignId);
    if (!campaign) return { kind: 'not_found' } as const;
    if (campaign.archivedAt !== null) {
      return {
        kind: 'refusal',
        code: 'archived',
        message: 'This campaign is archived, so its saved values are a historical record.',
        next: 'Nothing has changed.',
      } as const;
    }

    // The ANCHOR gates. `campaign_live_at` is the dedicated column §21 requires
    // and §33.12.1 scans for; a status string would be a second answer, and a
    // sweep would only notice after the fact.
    if (campaign.campaignLiveAt !== null) {
      const liveRefusal = liveEditRefusal(definition);
      if (liveRefusal) {
        return { kind: 'refusal', code: 'live_edit_refused', message: liveRefusal, next: 'Nothing has changed.' } as const;
      }
    }

    const written = await writeSetupColumn(tx, {
      campaignId: input.campaignId,
      definition,
      rowId,
      stored: coerced.stored,
      actor: who.actor,
    });
    if (written === 'row_not_found') {
      return {
        kind: 'refusal',
        code: 'row_not_found',
        message: `That ${definition.group === 'faqs' ? 'FAQ' : 'reward package'} is not on this campaign.`,
        next: 'Reload the stage. Nothing has changed.',
      } as const;
    }

    const draftVersion = await bumpDraftVersion(tx, input.campaignId, who.actor);

    const [edit] = await tx
      .insert(campaignAdminFieldEdits)
      .values({
        campaignId: input.campaignId,
        fieldKey: input.fieldKey,
        priorValue: written.prior,
        newValue: coerced.rendered,
        internalReason: internalReason.slice(0, 20000),
        materiality: definition.materiality,
        actor: who.actor,
      })
      .returning();

    await insertAuditEvent(tx, who, {
      action: 'campaign.admin_field_edited',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason,
      priorValue: { fieldKey: input.fieldKey, value: written.prior },
      newValue: {
        fieldKey: input.fieldKey,
        value: coerced.rendered,
        materiality: definition.materiality,
        draftVersion,
      },
      evidenceLinks: {
        table: definition.table,
        column: definition.column,
        ...(rowId ? { rowId } : {}),
      },
    });

    return {
      kind: 'ok',
      prior: written.prior,
      draftVersion,
      editId: edit!.id,
    } as const;
  });

  if (outcome.kind === 'not_found') {
    return refuse('not_found', 'There is no campaign at that address.', 'Go back to the Founder record.');
  }
  if (outcome.kind === 'refusal') {
    return refuse(outcome.code, outcome.message, outcome.next);
  }

  // §23.2's derived build status, re-mirrored. The one existing writer that
  // fits this route, and the only thing here that runs after the commit.
  await recomputeBuildStatus(db, input.campaignId);

  return {
    ok: true,
    fieldKey: input.fieldKey,
    label: definition.label,
    priorValue: outcome.prior,
    newValue: coerced.rendered,
    materiality: definition.materiality,
    draftVersion: outcome.draftVersion,
    editId: outcome.editId,
  };
}

/**
 * Locks the target row, reads the prior value, and writes the new one — all in
 * the caller's transaction. Returns the prior value rendered as text.
 */
async function writeSetupColumn(
  tx: Tx,
  input: {
    campaignId: string;
    definition: SetupFieldDefinition;
    rowId: string | null;
    stored: unknown;
    actor: string;
  },
): Promise<{ prior: string | null } | 'row_not_found'> {
  const { definition, rowId } = input;

  if (definition.table === 'campaign_build') {
    // The build row may not exist yet — a campaign whose Founder never opened
    // the build. Creating it here is not inventing content: every column stays
    // null and the derived status recomputes from the same emptiness.
    await tx
      .insert(campaignBuild)
      .values({ campaignId: input.campaignId, updatedBy: input.actor })
      .onConflictDoNothing();

    const [row] = await tx
      .select()
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, input.campaignId))
      .for('update');
    if (!row) return 'row_not_found';

    const prior = renderStoredValue((row as Record<string, unknown>)[definition.column!]);
    await tx
      .update(campaignBuild)
      .set({
        [definition.column!]: input.stored,
        updatedAt: new Date(),
        updatedBy: input.actor,
      })
      .where(eq(campaignBuild.campaignId, input.campaignId));
    return { prior };
  }

  if (definition.table === 'campaign_faqs') {
    if (!rowId) return 'row_not_found';
    const [row] = await tx
      .select()
      .from(campaignFaqs)
      .where(and(eq(campaignFaqs.id, rowId), eq(campaignFaqs.campaignId, input.campaignId)))
      .for('update');
    if (!row) return 'row_not_found';

    // Both FAQ columns are NOT NULL: an FAQ needs both a question and an
    // answer, and clearing one would leave a half-answer on a live page.
    if (input.stored === null) return 'row_not_found';

    const prior = renderStoredValue((row as Record<string, unknown>)[definition.column!]);
    await tx
      .update(campaignFaqs)
      .set({ [definition.column!]: input.stored })
      .where(eq(campaignFaqs.id, rowId));
    return { prior };
  }

  if (!rowId) return 'row_not_found';
  const [row] = await tx
    .select()
    .from(campaignRewardPackages)
    .where(
      and(
        eq(campaignRewardPackages.id, rowId),
        eq(campaignRewardPackages.campaignId, input.campaignId),
      ),
    )
    .for('update');
  if (!row) return 'row_not_found';

  // `badge` and `limited_quantity` are nullable; the other four are NOT NULL,
  // and a blanked reward field is a promise a Backer can no longer read.
  const nullable = definition.column === 'badge' || definition.column === 'limitedQuantity';
  if (input.stored === null && !nullable) return 'row_not_found';

  const prior = renderStoredValue((row as Record<string, unknown>)[definition.column!]);
  await tx
    .update(campaignRewardPackages)
    .set({ [definition.column!]: input.stored, updatedAt: new Date() })
    .where(eq(campaignRewardPackages.id, rowId));
  return { prior };
}

/**
 * `campaign_build.draft_version` + 1, in the same transaction as the change.
 *
 * `material_changes.new_version` counts MATERIAL changes only, so it does not
 * answer "which draft is this" — a non-material edit does not move it, and the
 * reference's `Draft version ${n}` means every recorded change. Hence a column
 * of its own (migration 0059), incremented in SQL so two concurrent edits
 * cannot read the same number and both write it.
 */
async function bumpDraftVersion(tx: Tx, campaignId: string, actor: string): Promise<number> {
  await tx
    .insert(campaignBuild)
    .values({ campaignId, updatedBy: actor })
    .onConflictDoNothing();

  const [row] = await tx
    .update(campaignBuild)
    .set({ draftVersion: sql`${campaignBuild.draftVersion} + 1` })
    .where(eq(campaignBuild.campaignId, campaignId))
    .returning({ draftVersion: campaignBuild.draftVersion });

  return row?.draftVersion ?? 1;
}
