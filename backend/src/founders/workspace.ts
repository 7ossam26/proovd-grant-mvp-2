/**
 * The Founder Admin workspace — Spec §26.1, §26.2, §7, §9, §10, §13, §22.3.
 *
 * One person, five panes, composed from the records that already own every
 * fact. `types.ts` is the contract; this file fills it.
 *
 * ── Person-scoped, and that is the correction ───────────────────────────────
 * The previous surface keyed on `draftId`, so a Founder whose campaign was
 * archived-and-restarted (§9's wrong-type path) appeared twice with no
 * relationship between the rows. `founder_prospects` is what survives a
 * restart — a restart makes a NEW campaign, draft, and vetting record for the
 * SAME prospect — so the prospect is the person, and every read below starts
 * there and fans out through `campaign_drafts.prospect_id`.
 *
 * ── Compose, never duplicate ────────────────────────────────────────────────
 * Nothing here stores a derived fact and nothing here re-derives one that
 * another module owns. The §22.3 money block is `readFounderPaymentStatus`
 * (§33.8.13's one resolver, many renderers); the Stripe block is
 * `readOnboardingState`; the listing lines are the payment row's own stored
 * `discount_lines`; the account standing is `deriveAccountState` over three
 * records. A workspace that recomputed a payment amount would be a second
 * source of truth for a number somebody is paid.
 *
 * ── Absence is a value ──────────────────────────────────────────────────────
 * Every money section carries `populated` and, when false, what it is waiting
 * for — §16a's rule, which matters most here: a campaign whose close batch has
 * not run has a `0` in every ledger column, and rendering that as US$0.00 is
 * indistinguishable from one that captured nothing.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

import type {
  CampaignFactsView,
  CampaignSummary,
  CampaignsPane,
  DetailField,
  DetailsPane,
  DiscoveryView,
  FounderAttention,
  FounderHeader,
  FounderListRow,
  FounderMenuAction,
  FounderWorkspaceDetail,
  EligibilityView,
  InvitationView,
  MeetingNoteView,
  MoneyPane,
  MoneySection,
  OverrideField,
  OverviewPane,
  PreviousCampaign,
  VettingView,
} from './types.js';
import {
  CAMPAIGN_TYPE_LOCK_NOTE,
  DELETION_RETENTION_NOTE,
  FOUNDER_EDITABLE_FIELDS,
  IDENTITY_CHECK_HELPER,
  PROFILE_OVERRIDE_FIELDS,
  REQUIRED_EMAILS_HELPER,
  REQUIRED_EMAILS_LABEL,
  SUMMARY_IS_NOT_ADMIN_WRITABLE,
  SUMMARY_NOT_CHOSEN_LABEL,
  campaignStatusLabel,
  campaignTypeLabel,
  deriveAccountState,
  deriveInvitationState,
  deriveSetupStage,
  invitationMeaning,
  invitationLinkIsLive,
  overrideHelper,
  stickerFor,
  type FounderAccountState,
  type FounderSetupStage,
  type InvitationState,
  type ProfileOverrideKey,
} from './logic.js';
import { actorName, daysUntil, formatDay, formatInstant, resolveActorNames } from './format.js';
import { historyCountsOf, readFounderHistory } from './history.js';
import { composeCommunications, composeOperations } from './operations.js';
import {
  actionCells,
  campaignDayOf,
  directoryFilters,
  directoryTypeLabel,
  lifecycleLabel,
  typeChipLabel,
  type DirectoryFacts,
} from './directory.js';

import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import {
  campaignDrafts,
  campaignInvitationSends,
  founderProspects,
  type CampaignDraft,
  type FounderProspect,
} from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import {
  campaignVetting,
  founderClaimProfiles,
  policyConsents,
  type FounderClaimProfile,
} from '../db/schema/vetting.js';
import { account, user } from '../db/schema/auth.js';
import { campaignBuild, campaignReviews, reviewFeedbackItems } from '../db/schema/build.js';
import { listingFeePayments, listingFeeRefunds } from '../db/schema/listing.js';
import { highEffortClassifications } from '../db/schema/workspace.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignEnforcementActions } from '../db/schema/support.js';
import {
  founderGhostBans,
  campaignFulfillment,
  day14EvidenceSubmissions,
  type FounderGhostBan,
} from '../db/schema/fulfillment.js';
import { notificationDigestPreferences } from '../db/schema/digest.js';
import {
  founderAccessActions,
  founderDeletionRequests,
  founderDeletionReviews,
  founderMeetingNotes,
} from '../db/schema/founder-workspace.js';

import { previewInvitation, type InvitationContext } from '../invitations/service.js';
import { NO_GUARANTEE_TEXT, PROCESS_SUMMARY } from '../notifications/templates/founder-invitation.js';
import { readPossibleCreatorSignal } from '../vetting/service.js';
import { readNextCampaignReadiness } from '../completion/next-campaign.js';
import {
  readFounderPaymentStatus,
  type FounderPaymentStatusView,
} from '../close/founder-payments.js';
import { readOnboardingState, type OnboardingContext } from '../payments/onboarding.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import { formatUsdCents } from '../payments/listing-notifications.js';
import { OPTIONAL_ITEM_LABELS } from '../notifications/templates/listing-fee.js';
import { GHOST_BAN_TRIGGER_LABELS, type GhostBanTrigger } from '../fulfillment/logic.js';

/* ── Labels that shared owns and `logic.ts` did not restate ────────────────── */

/**
 * §7's three fixed content rows, and §9's step names.
 *
 * `shared/src/admin/founder-workspace.ts` owns the first set and
 * `shared/src/vetting/steps.ts` the second; `logic.ts` restates neither, and
 * the backend cannot import shared at runtime (`rootDir: src`). So they are
 * restated here, next to the only code that renders them, rather than being
 * bent into a register that does not carry them. They are labels for facts —
 * changing one changes a word on a screen and nothing else — which is why this
 * is a smaller risk than the vocabularies `logic.ts` does restate and the
 * suite drift-tests.
 */
const INVITATION_FIXED_CONTENT = [
  { key: 'invNext', label: 'What happens next' },
  { key: 'invExpect', label: 'Expectations we show the Founder' },
  { key: 'invSupport', label: 'Support contact' },
] as const;

/**
 * §9's three answered steps (2026-08-18: the 2026-08-10 deviation withdrawn —
 * Positioning is asked again and the amount of views is not).
 */
const VETTING_STEP_LABELS = ['Problem', 'Solution', 'Positioning'] as const;

/**
 * The views-range labels, restated from `shared/src/vetting/steps.ts` (the
 * backend cannot import shared at runtime) and drift-tested.
 *
 * Retired from collection. Kept because the answers a Founder already gave are
 * still theirs and Admin still has to be able to read them.
 */
const VIEWS_RANGE_LABELS: Record<string, string> = {
  under_10k: 'Under 10,000',
  '10k_100k': '10,000 – 100,000',
  '100k_1m': '100,000 – 1,000,000',
  over_1m: 'Over 1,000,000',
};

/**
 * What renders where a stored views answer would have been, on a campaign
 * onboarded after the question was retired. Restated from shared and
 * drift-tested, like the labels above.
 */
const VIEWS_NOT_COLLECTED_LABEL =
  'Not collected — this question was retired on 18 August 2026 and was never asked on this campaign.';

const CREATOR_MATCH_STEP_LABEL = 'Potential Creator matches';
const ACCOUNT_CREATED_STEP_LABEL = 'Account created';

/**
 * §23.2's two parallel tracks, in the words §3.1 permits.
 *
 * `campaign_build_status` and `affiliate_roster_status` are enums a support
 * call would otherwise read aloud. Neither register carries a label, so both
 * are named here and the raw value never leaves this file for a surface.
 */
const BUILD_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
};

const ROSTER_STATUS_LABELS: Record<string, string> = {
  forming: 'Finding and confirming Creators',
  launch_ready: 'Creators ready for launch',
  failed: 'No Creator accepted',
};

/* ── Payment-setup vocabulary (§13) ────────────────────────────────────────── */

const PAYMENT_SETUP_LABELS: Record<string, string> = {
  not_started: 'Not started',
  more_information_required: 'Setup in progress',
  under_review: 'Being reviewed',
  restricted: 'Restricted',
  complete: 'Ready',
};

/**
 * §13 stores Stripe's status; Proovd verifies nobody's identity itself.
 * `IDENTITY_CHECK_HELPER` rides every one of these so the distinction is on the
 * screen rather than in this comment.
 */
const IDENTITY_LABELS: Record<string, string> = {
  not_started: 'Not started',
  more_information_required: 'Information needed',
  under_review: 'Being reviewed',
  restricted: 'Restricted by Stripe',
  complete: 'Verified',
};

const SETUP_BODIES: Record<string, (name: string) => string> = {
  not_started: (name) => `${name} has not started Stripe payment setup.`,
  more_information_required: (name) =>
    `${name} started Stripe payment setup but has not completed it.`,
  under_review: () => 'Stripe is reviewing the payment setup.',
  restricted: () =>
    'Stripe has restricted the payment setup. The Founder cannot continue with campaign payment activity until the issue is resolved.',
  complete: () => 'Stripe payment setup is complete.',
};

/**
 * What the money pane says when this deployment has no Stripe client at all.
 *
 * Not "Not started" — that would be a claim about the Founder. §1.4: an absent
 * capability is named as one.
 */
const STRIPE_UNCONFIGURED = 'Not available';
const STRIPE_UNCONFIGURED_BODY =
  'Stripe is not configured on this deployment, so Proovd cannot read the Founder’s payment setup.';

/* ── The context every pane reads from ─────────────────────────────────────── */

export interface FounderCampaignRow {
  campaign: typeof campaigns.$inferSelect;
  draftId: string;
  title: string | null;
  orderThreshold: number | null;
}

export interface FounderIdentity {
  legalName: string;
  preferredName: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  website: string | null;
  state: string | null;
  country: string | null;
}

export interface FounderContext {
  prospect: FounderProspect;
  claim: FounderClaimProfile | null;
  identity: FounderIdentity;
  accountUserId: string | null;
  accountCreatedAt: Date | null;
  signInMethod: string | null;
  drafts: CampaignDraft[];
  currentDraft: CampaignDraft | null;
  campaignRows: FounderCampaignRow[];
  currentCampaign: FounderCampaignRow | null;
  previousCampaigns: FounderCampaignRow[];
  ban: FounderGhostBan | null;
  latestAccess: typeof founderAccessActions.$inferSelect | null;
  accountState: FounderAccountState;
}

/**
 * Whether a value from a URL could be a record id at all.
 *
 * `founder_prospects.id` is a `uuid` column, so a value that is not one cannot
 * miss — it makes the query itself fail, and a truncated or hand-pasted address
 * becomes a 500 carrying a database error instead of a surface. §1.1 requires
 * the not-found state to be answered, and §27.1 requires it to say what
 * happened, so an unreadable id gets the same answer a real miss gets: there is
 * no Founder at that address, because there is no address.
 */
const RECORD_ID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function looksLikeRecordId(value: string): boolean {
  return RECORD_ID_SHAPE.test(value);
}

/**
 * Everything person-shaped, in one read.
 *
 * The current campaign is the most recent NON-archived one: §9 archives a
 * wrong-type record and starts a fresh container, and the archived row is a
 * previous campaign in every sense an Admin means. Everything else — including
 * the archived rows — is `previous`.
 */
export async function loadFounderContext(
  db: Database,
  prospectId: string,
): Promise<FounderContext | null> {
  if (!looksLikeRecordId(prospectId)) return null;

  const [prospect] = await db
    .select()
    .from(founderProspects)
    .where(eq(founderProspects.id, prospectId))
    .limit(1);
  if (!prospect) return null;

  const drafts = await db
    .select()
    .from(campaignDrafts)
    .where(eq(campaignDrafts.prospectId, prospectId))
    .orderBy(desc(campaignDrafts.createdAt));

  const campaignRows: FounderCampaignRow[] = drafts.length
    ? (
        await db
          .select({
            campaign: campaigns,
            draftId: campaignDrafts.id,
            title: campaignBuild.title,
            orderThreshold: campaignBuild.orderThreshold,
          })
          .from(campaignDrafts)
          .innerJoin(campaigns, eq(campaigns.id, campaignDrafts.campaignId))
          .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
          .where(eq(campaignDrafts.prospectId, prospectId))
          // Ordered by the DRAFT's creation, not the campaign's. §33.12.1's
          // scan forbids reading `campaigns.created_at`/`updated_at` at all,
          // because a campaign anchor inferred from a row timestamp is the
          // §21 mistake this codebase is built to make impossible. The draft
          // is written in the same transaction as its campaign, so this is the
          // same ordering from a column that is nobody's anchor.
          .orderBy(desc(campaignDrafts.createdAt))
      ).map((row) => ({
        campaign: row.campaign,
        draftId: row.draftId,
        title: row.title,
        orderThreshold: row.orderThreshold,
      }))
    : [];

  const currentCampaign = campaignRows.find((row) => row.campaign.archivedAt === null) ?? null;
  const previousCampaigns = campaignRows.filter((row) => row !== currentCampaign);

  const currentDraft =
    (currentCampaign ? drafts.find((d) => d.id === currentCampaign.draftId) : undefined) ??
    drafts[0] ??
    null;

  const [claim] = currentDraft
    ? await db
        .select()
        .from(founderClaimProfiles)
        .where(eq(founderClaimProfiles.prospectId, prospectId))
        .orderBy(desc(founderClaimProfiles.createdAt))
        .limit(1)
    : [];

  const accountUserId = prospect.claimedUserId ?? claim?.claimedUserId ?? null;

  const [accountRow] = accountUserId
    ? await db
        .select({ createdAt: user.createdAt })
        .from(user)
        .where(eq(user.id, accountUserId))
        .limit(1)
    : [];

  const providers = accountUserId
    ? await db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, accountUserId))
    : [];

  const [ban] = accountUserId
    ? await db
        .select()
        .from(founderGhostBans)
        .where(eq(founderGhostBans.founderUserId, accountUserId))
        .limit(1)
    : [];

  const [latestAccess] = await db
    .select()
    .from(founderAccessActions)
    .where(eq(founderAccessActions.prospectId, prospectId))
    .orderBy(desc(founderAccessActions.occurredAt))
    .limit(1);

  const identity: FounderIdentity = {
    legalName: claim?.legalName ?? prospect.legalName ?? '',
    preferredName:
      claim?.preferredName ?? prospect.preferredName ?? claim?.legalName ?? prospect.legalName ?? '',
    email: claim?.email ?? prospect.email ?? '',
    phone: claim?.phone ?? prospect.phone ?? null,
    businessName: claim?.businessName ?? prospect.businessName ?? null,
    website: prospect.productUrl ?? null,
    state: claim?.stateRegion ?? prospect.stateRegion ?? null,
    country: claim?.country ?? prospect.country ?? null,
  };

  return {
    prospect,
    claim: claim ?? null,
    identity,
    accountUserId,
    accountCreatedAt: claim?.claimedAt ?? accountRow?.createdAt ?? null,
    signInMethod: signInMethodOf(providers.map((p) => p.providerId)),
    drafts,
    currentDraft,
    campaignRows,
    currentCampaign,
    previousCampaigns,
    ban: ban ?? null,
    latestAccess: latestAccess ?? null,
    accountState: deriveAccountState({
      accountClaimed: accountUserId !== null,
      banned: Boolean(ban),
      latestAccessAction: (latestAccess?.action as 'suspend' | 'restore' | undefined) ?? null,
    }),
  };
}

function signInMethodOf(providerIds: readonly string[]): string | null {
  if (providerIds.length === 0) return null;
  if (providerIds.includes('google')) return 'Google';
  if (providerIds.includes('credential')) return 'Email and password';
  return providerIds.join(' · ');
}

/* ── The list (§26.1) ──────────────────────────────────────────────────────── */

export interface FounderListDeps {
  db: Database;
  now?: Date | undefined;
}

/**
 * One row per PERSON.
 *
 * `invitations/service.ts` still exports a per-draft `listFounders`, and it is
 * still correct for what it does — the draft surface is about one invitation.
 * This is the Users → Founders table, and a Founder who restarted appearing
 * twice with no relationship between the rows was the defect that made the
 * workspace person-scoped in the first place.
 *
 * Everything is loaded in grouped queries rather than per row: an Admin list
 * that issued eight queries per Founder would be the kind of surface people
 * stop opening.
 */
export async function listFounders(deps: FounderListDeps): Promise<FounderListRow[]> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const prospects = await db
    .select()
    .from(founderProspects)
    .orderBy(desc(founderProspects.createdAt));
  if (prospects.length === 0) return [];

  const prospectIds = prospects.map((p) => p.id);

  const draftRows = await db
    .select({
      draft: campaignDrafts,
      campaign: campaigns,
      title: campaignBuild.title,
    })
    .from(campaignDrafts)
    .innerJoin(campaigns, eq(campaigns.id, campaignDrafts.campaignId))
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .where(inArray(campaignDrafts.prospectId, prospectIds))
    // Same reason as above: order by the draft, never by a campaign row
    // timestamp (§33.12.1).
    .orderBy(desc(campaignDrafts.createdAt));

  const draftIds = draftRows.map((row) => row.draft.id);

  // Every send row rather than a count: the directory's pre-claim lifecycle
  // needs the LATEST send's delivery confirmation (`notification_id` null is
  // "recorded, not confirmed" — Phase 06b's state), and admin-scale data makes
  // the reduce cheaper than a second grouped query.
  const sendRows = draftIds.length
    ? await db
        .select({
          draftId: campaignInvitationSends.draftId,
          notificationId: campaignInvitationSends.notificationId,
          sentAt: campaignInvitationSends.sentAt,
        })
        .from(campaignInvitationSends)
        .where(inArray(campaignInvitationSends.draftId, draftIds))
        .orderBy(desc(campaignInvitationSends.sentAt))
    : [];

  const vettingRows = draftIds.length
    ? await db
        .select({
          draftId: campaignVetting.draftId,
          selectedType: campaignVetting.selectedType,
          problem: campaignVetting.problemText,
          solution: campaignVetting.solutionText,
          viewsRange: campaignVetting.viewsRange,
        })
        .from(campaignVetting)
        .where(inArray(campaignVetting.draftId, draftIds))
    : [];

  const claims = await db
    .select({
      prospectId: founderClaimProfiles.prospectId,
      claimedUserId: founderClaimProfiles.claimedUserId,
      legalName: founderClaimProfiles.legalName,
      preferredName: founderClaimProfiles.preferredName,
      email: founderClaimProfiles.email,
      businessName: founderClaimProfiles.businessName,
    })
    .from(founderClaimProfiles)
    .where(inArray(founderClaimProfiles.prospectId, prospectIds));

  const accessRows = await db
    .select({
      prospectId: founderAccessActions.prospectId,
      action: founderAccessActions.action,
      reason: founderAccessActions.reason,
      occurredAt: founderAccessActions.occurredAt,
    })
    .from(founderAccessActions)
    .where(inArray(founderAccessActions.prospectId, prospectIds))
    .orderBy(desc(founderAccessActions.occurredAt));

  const userIds = [
    ...new Set(
      [...prospects.map((p) => p.claimedUserId), ...claims.map((c) => c.claimedUserId)].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  ];

  const bans = userIds.length
    ? await db
        .select({ founderUserId: founderGhostBans.founderUserId })
        .from(founderGhostBans)
        .where(inArray(founderGhostBans.founderUserId, userIds))
    : [];

  const connected = userIds.length
    ? await db
        .select({
          ownerUserId: stripeConnectedAccounts.ownerUserId,
          state: stripeConnectedAccounts.state,
        })
        .from(stripeConnectedAccounts)
        .where(
          and(
            inArray(stripeConnectedAccounts.ownerUserId, userIds),
            eq(stripeConnectedAccounts.role, 'founder_seller'),
          ),
        )
    : [];

  // Which day_14_review campaigns already hold a submitted receipt, so the
  // Founder column stops asking for evidence somebody already sent (§1.4).
  const day14CampaignIds = draftRows
    .filter((row) => row.campaign.status === 'day_14_review')
    .map((row) => row.campaign.id);
  const day14Receipts = day14CampaignIds.length
    ? await db
        .select({ campaignId: day14EvidenceSubmissions.campaignId })
        .from(day14EvidenceSubmissions)
        .where(inArray(day14EvidenceSubmissions.campaignId, day14CampaignIds))
    : [];
  const day14Submitted = new Set(day14Receipts.map((row) => row.campaignId));

  const draftsByProspect = new Map<string, typeof draftRows>();
  for (const row of draftRows) {
    const list = draftsByProspect.get(row.draft.prospectId) ?? [];
    list.push(row);
    draftsByProspect.set(row.draft.prospectId, list);
  }
  const sendsByDraft = new Map<string, { count: number; latestConfirmed: boolean }>();
  for (const row of sendRows) {
    const entry = sendsByDraft.get(row.draftId);
    if (entry) {
      entry.count += 1;
    } else {
      // Rows arrive newest-first, so the first row seen per draft IS the latest.
      sendsByDraft.set(row.draftId, { count: 1, latestConfirmed: row.notificationId !== null });
    }
  }
  const vettingByDraft = new Map(vettingRows.map((row) => [row.draftId, row]));
  const claimByProspect = new Map(claims.map((row) => [row.prospectId, row]));
  const latestAccessByProspect = new Map<string, { action: string; reason: string }>();
  for (const row of accessRows) {
    if (!latestAccessByProspect.has(row.prospectId)) {
      latestAccessByProspect.set(row.prospectId, { action: row.action, reason: row.reason });
    }
  }
  const bannedUsers = new Set(bans.map((row) => row.founderUserId));
  const stateByUser = new Map(connected.map((row) => [row.ownerUserId, row.state]));

  const rows: FounderListRow[] = [];

  for (const prospect of prospects) {
    const owned = draftsByProspect.get(prospect.id) ?? [];
    const current = owned.find((row) => row.campaign.archivedAt === null) ?? null;
    const draft = current ?? owned[0] ?? null;
    const claim = claimByProspect.get(prospect.id) ?? null;
    const accountUserId = prospect.claimedUserId ?? claim?.claimedUserId ?? null;

    const vetting = draft ? vettingByDraft.get(draft.draft.id) : undefined;
    const answered = countAnswered(vetting);
    const access = latestAccessByProspect.get(prospect.id) ?? null;

    const accountState = deriveAccountState({
      accountClaimed: accountUserId !== null,
      banned: accountUserId !== null && bannedUsers.has(accountUserId),
      latestAccessAction: (access?.action as 'suspend' | 'restore' | undefined) ?? null,
    });

    const preferredName =
      claim?.preferredName ?? prospect.preferredName ?? claim?.legalName ?? prospect.legalName ?? '';

    // The list and the detail must not disagree about whether a Founder needs
    // attention, so both feed the SAME kernel from the same facts. The gate
    // below is cost, not policy: a campaign that has never closed has no §22.3
    // payment to be blocked on — so the read is not skipped where it could
    // have produced an answer.
    const paymentStatus =
      current && current.campaign.campaignCloseAt !== null
        ? await readFounderPaymentStatus(db, { campaignId: current.campaign.id, now })
        : null;

    const attention = deriveAttention({
      accountState,
      preferredName,
      standingDetail: access?.action === 'suspend' ? access.reason : null,
      moneyBlocker: firstMoneyBlocker(paymentStatus),
      campaignIssue: current ? await campaignIssueOf(db, current.campaign) : null,
    });

    const sends = draft ? (sendsByDraft.get(draft.draft.id) ?? null) : null;
    const facts: DirectoryFacts = {
      status: current ? (current.campaign.status as DirectoryFacts['status']) : null,
      typeRaw: current?.campaign.type ?? null,
      typeLocked: current?.campaign.typeLockedAt !== null && current !== null,
      sends: sends?.count ?? 0,
      latestSendConfirmed: sends ? sends.latestConfirmed : null,
      vettingAnswered: answered,
      claimed: accountUserId !== null,
      liveAt: current?.campaign.campaignLiveAt ?? null,
      accountState,
      attention,
      preferredName,
      day14EvidenceSubmitted: current ? day14Submitted.has(current.campaign.id) : false,
      now,
    };

    const { adminAction, founderAction } = actionCells(facts);
    const typeLabel = directoryTypeLabel(facts);
    const lifecycle = lifecycleLabel(facts);
    const legalName = claim?.legalName ?? prospect.legalName ?? '';
    const email = claim?.email ?? prospect.email ?? '';
    const businessName = claim?.businessName ?? prospect.businessName ?? null;
    const owner = prospect.internalOwner ?? null;
    const campaignName = current ? campaignNameOf(current.title, prospect.productName) : null;

    rows.push({
      prospectId: prospect.id,
      recordReference: prospect.recordReference,
      legalName,
      preferredName,
      email,
      productName: prospect.productName ?? '',
      businessName,
      owner,
      typeLabel,
      lifecycle,
      adminAction,
      founderAction,
      filters: directoryFilters(facts, adminAction),
      // One source for every match: the search box, the Type filter's text
      // fallback, and a future palette all read this — the Creators-directory
      // rule, so two matchers can never disagree.
      searchText: [
        legalName,
        preferredName,
        email,
        businessName,
        prospect.productName,
        owner,
        prospect.recordReference,
        campaignName,
        typeLabel,
        lifecycle,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .toLowerCase(),
      setup: deriveSetupStage({
        invitationSent: (sends?.count ?? 0) > 0,
        answered,
        total: VETTING_STEP_LABELS.length,
        signupComplete: accountUserId !== null,
      }),
      account: accountState,
      paymentSetup: paymentSetupLabel(accountUserId ? stateByUser.get(accountUserId) : undefined),
      currentCampaign: current
        ? {
            campaignId: current.campaign.id,
            name: campaignName ?? '',
            status: campaignStatusLabel(current.campaign.status),
          }
        : null,
      attention,
    });
  }

  return rows;
}

function countAnswered(vetting: {
  problem: string | null;
  solution: string | null;
  viewsRange: string | null;
} | undefined): number {
  if (!vetting) return 0;
  return [vetting.problem, vetting.solution, vetting.viewsRange].filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  ).length;
}

function paymentSetupLabel(state: string | undefined): string {
  if (!state) return PAYMENT_SETUP_LABELS['not_started']!;
  return PAYMENT_SETUP_LABELS[state] ?? STRIPE_UNCONFIGURED;
}

function campaignNameOf(title: string | null, productName: string | null): string {
  return title ?? productName ?? 'Untitled campaign';
}

/* ── Attention: one thing, or nothing ──────────────────────────────────────── */

interface AttentionInput {
  accountState: FounderAccountState;
  standingDetail: string | null;
  moneyBlocker: string | null;
  campaignIssue: string | null;
  preferredName: string;
}

/**
 * §20's Act ranking, applied to a person rather than a campaign.
 *
 * One thing or nothing, and `needed: false` is a first-class answer rather than
 * an empty object — DNA §5.4's done-moment, and the reason a row reads "No
 * action needed" instead of showing a blank cell that looks like missing data.
 *
 * The order is not arbitrary and is not a rule about money: it is severity for
 * the PERSON. A suspended Founder cannot act at all; a payment blocker is money
 * already earned and waiting; a campaign issue is work in progress. Nothing
 * here decides anything — every branch names a fact another module recorded.
 * (The possible-creator branch went with the simplified flow: the assessment
 * no longer blocks the Founder, so its absence is not a person stuck.)
 */
export function deriveAttention(input: AttentionInput): FounderAttention {
  if (input.accountState === 'Permanently banned') {
    return {
      needed: true,
      text: `${input.preferredName} is permanently banned from running campaigns.`,
      action: { label: 'View decision', act: 'jump-access' },
    };
  }
  if (input.accountState === 'Access suspended') {
    return {
      needed: true,
      text:
        input.standingDetail ??
        `${input.preferredName}’s access is suspended while Proovd reviews the account.`,
      action: { label: 'View review', act: 'jump-access' },
    };
  }
  if (input.moneyBlocker) {
    return {
      needed: true,
      text: input.moneyBlocker,
      action: { label: 'Open money', act: 'jump-money' },
    };
  }
  if (input.campaignIssue) {
    return {
      needed: true,
      text: input.campaignIssue,
      // A real destination since 2026-08-16: the Campaigns workspace owns
      // campaign operations, and the surface resolves the campaign id from
      // the same payload this attention rides on.
      action: { label: 'Open campaign', act: 'open-campaign' },
    };
  }
  return { needed: false };
}

/** The first named blocker on a campaign's §22.3 payments, or null. */
function firstMoneyBlocker(status: FounderPaymentStatusView | null): string | null {
  if (!status || !status.applicable) return null;
  for (const line of status.payments) {
    if (line.status === 'blocked' && line.blockers.length > 0) return line.blockers[0]!;
  }
  return null;
}

/* ── The detail ────────────────────────────────────────────────────────────── */

export interface FounderWorkspaceDeps {
  db: Database;
  invitationContext: InvitationContext;
  /** Absent when this deployment has no Stripe client (§32.2). */
  onboarding?: OnboardingContext | undefined;
  now?: Date | undefined;
}

export async function readFounderWorkspace(
  deps: FounderWorkspaceDeps,
  prospectId: string,
): Promise<FounderWorkspaceDetail | null> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const ctx = await loadFounderContext(db, prospectId);
  if (!ctx) return null;

  const campaignIds = ctx.campaignRows.map((row) => row.campaign.id);
  const draftIds = ctx.drafts.map((draft) => draft.id);

  const paymentStatuses = new Map<string, FounderPaymentStatusView | null>();
  for (const row of ctx.campaignRows) {
    paymentStatuses.set(
      row.campaign.id,
      await readFounderPaymentStatus(db, { campaignId: row.campaign.id, now }),
    );
  }

  const overview = await composeOverview(deps, ctx, now);
  const details = await composeDetails(db, ctx);
  const campaignsPane = await composeCampaigns(db, ctx, now);
  const money = await composeMoney(deps, ctx, paymentStatuses);

  const currentStatus = ctx.currentCampaign
    ? (paymentStatuses.get(ctx.currentCampaign.campaign.id) ?? null)
    : null;

  const attention = deriveAttention({
    accountState: ctx.accountState,
    preferredName: ctx.identity.preferredName,
    standingDetail: details.standing.detail,
    moneyBlocker: firstMoneyBlocker(currentStatus),
    campaignIssue: campaignsPane.current?.issue ?? null,
  });

  const history = await readFounderHistory(db, {
    prospectId,
    draftIds,
    campaignIds,
    founderUserId: ctx.accountUserId,
    preferredName: ctx.identity.preferredName,
  });

  // The record header feeds the SAME directory kernels the list feeds, from
  // the same facts, so the row an Admin clicked and the record that opens can
  // never disagree about the person's type, lifecycle, or who owes what.
  const currentDraftSends = ctx.currentDraft
    ? await db
        .select({
          notificationId: campaignInvitationSends.notificationId,
        })
        .from(campaignInvitationSends)
        .where(eq(campaignInvitationSends.draftId, ctx.currentDraft.id))
        .orderBy(desc(campaignInvitationSends.sentAt))
    : [];
  const day14Receipt =
    ctx.currentCampaign?.campaign.status === 'day_14_review'
      ? await db
          .select({ id: day14EvidenceSubmissions.id })
          .from(day14EvidenceSubmissions)
          .where(eq(day14EvidenceSubmissions.campaignId, ctx.currentCampaign.campaign.id))
          .limit(1)
      : [];

  const facts: DirectoryFacts = {
    status: ctx.currentCampaign
      ? (ctx.currentCampaign.campaign.status as DirectoryFacts['status'])
      : null,
    typeRaw: ctx.currentCampaign?.campaign.type ?? null,
    typeLocked:
      ctx.currentCampaign !== null && ctx.currentCampaign.campaign.typeLockedAt !== null,
    sends: currentDraftSends.length,
    latestSendConfirmed:
      currentDraftSends.length > 0 ? currentDraftSends[0]!.notificationId !== null : null,
    vettingAnswered: overview.vetting.progress
      .slice(0, VETTING_STEP_LABELS.length)
      .filter((step) => step.done).length,
    claimed: ctx.accountUserId !== null,
    liveAt: ctx.currentCampaign?.campaign.campaignLiveAt ?? null,
    accountState: ctx.accountState,
    attention,
    preferredName: ctx.identity.preferredName,
    day14EvidenceSubmitted: day14Receipt.length > 0,
    now,
  };
  const { adminAction, founderAction } = actionCells(facts);

  const discovery = await composeDiscovery(db, ctx);
  const eligibility = await composeEligibility(db, ctx, overview);
  const campaignFacts = await composeCampaignFacts(db, ctx, now);
  const operations = await composeOperations(db, ctx, now);
  const communications = await composeCommunications(db, ctx);

  const header: FounderHeader = {
    prospectId,
    recordReference: ctx.prospect.recordReference,
    legalName: ctx.identity.legalName,
    preferredName: ctx.identity.preferredName,
    businessName: ctx.identity.businessName,
    website: ctx.identity.website,
    email: ctx.identity.email,
    phone: ctx.identity.phone,
    phoneVerified: false,
    state: ctx.identity.state,
    country: ctx.identity.country,
    sticker: stickerFor(prospectId),
    typeChip: typeChipLabel(facts),
    lifecycle: lifecycleLabel(facts),
    adminAction,
    founderAction,
    account: ctx.accountState,
    setup: setupStageOf(ctx, overview),
    paymentSetup: money.setup.value,
    currentCampaign: ctx.currentCampaign
      ? {
          campaignId: ctx.currentCampaign.campaign.id,
          name: campaignNameOf(ctx.currentCampaign.title, ctx.prospect.productName),
          status: campaignStatusLabel(ctx.currentCampaign.campaign.status),
        }
      : null,
    attention,
    availableActions: availableActionsFor(ctx, overview.invitation.state),
  };

  return {
    header,
    overview,
    details,
    campaigns: campaignsPane,
    money,
    discovery,
    eligibility,
    campaignFacts,
    operations,
    communications,
    history,
    historyCounts: historyCountsOf(history),
  };
}

/* ── Eligibility (§10, §5, Session B 2026-08-17) ───────────────────────────── */

/**
 * The Eligibility tab's read-only facts: the claim, the recorded
 * representations, and the `policy_consents` rows the claim wrote.
 *
 * Nothing here is derivable-by-Admin, and nothing is editable from the tab —
 * that is the tab's whole point (`ELIGIBILITY_READ_ONLY_NOTE`). Three answers
 * for every fact, not two: `null` means no claim profile exists yet, which is
 * not "No" (§16a — a representation nobody has been asked for is not one that
 * was declined). The 18+/US facts are the Founder's recorded REPRESENTATIONS
 * (§10): the product derives no age from the DOB and never claims to have
 * verified one, which is why `dobSupplied` reports presence and nothing else.
 */
async function composeEligibility(
  db: Database,
  ctx: FounderContext,
  overview: OverviewPane,
): Promise<EligibilityView> {
  const claim = ctx.claim;

  const consents = ctx.accountUserId
    ? await db
        .select({
          slug: policyConsents.slug,
          version: policyConsents.version,
          acceptedAt: policyConsents.acceptedAt,
        })
        .from(policyConsents)
        .where(
          and(
            eq(policyConsents.subjectType, 'user'),
            eq(policyConsents.subjectId, ctx.accountUserId),
          ),
        )
        .orderBy(desc(policyConsents.acceptedAt))
    : [];

  const location =
    claim?.stateRegion || claim?.country
      ? [claim?.stateRegion, claim?.country].filter(Boolean).join(' · ')
      : null;

  return {
    claim: {
      inviteClaimed: ctx.prospect.claimedAt !== null,
      claimedAt: formatInstant(ctx.prospect.claimedAt),
      accountCreatedAt: overview.accountCreatedAt,
      completion: claim?.claimedAt ? 'Complete' : claim ? 'In progress' : 'Not started',
      connectedRecord: ctx.prospect.recordReference,
    },
    facts: {
      dobSupplied: claim ? claim.dateOfBirth !== null : null,
      age18Plus: claim ? claim.representationAge18Plus : null,
      usPerson: claim ? claim.representationUsPerson : null,
      location,
      sanctionsClear: claim ? claim.representationSanctions : null,
    },
    acknowledgements: consents.map((consent) => ({
      label: POLICY_CONSENT_LABELS[consent.slug] ?? consent.slug,
      version: consent.version,
      acceptedAt: formatInstant(consent.acceptedAt) ?? consent.acceptedAt.toISOString(),
    })),
    // Two different absences, said apart (§1.4): a person who has not claimed
    // has not been asked, while a completed claim with no consent rows cannot
    // exist — the claim refuses while the policies are drafts, so the honest
    // in-between is "the claim has not completed yet".
    acknowledgementsAbsent:
      consents.length > 0
        ? null
        : ctx.accountUserId === null
          ? 'Recorded at the account claim. This Founder has not claimed an account yet.'
          : 'The account claim has not completed yet, so no acceptance is recorded. A consent can cite only a published policy version.',
  };
}

/**
 * §3.1 labels for the consent slugs a Founder claim records. An unknown slug
 * renders as itself — a new document should be visible, not hidden.
 */
const POLICY_CONSENT_LABELS: Record<string, string> = {
  terms: 'Terms of Service',
  'founder-aup': 'Founder Acceptable Use Policy',
  privacy: 'Privacy Policy',
  'affiliate-aup': 'Creator Acceptable Use Policy',
  'ip-agreement': 'IP & Promotion Agreement',
};

/* ── Discovery & internal context (§7, 2026-08-16 rebuild) ─────────────────── */

/**
 * §7's discovery record under the record's own field names, plus the meeting
 * notes (migration 0047) and the research entries.
 *
 * The `key` on each row is the `PUT …/:draftId/prospect` key it edits, so this
 * panel and the intake form write through one path. A null key is a derived
 * value with no edit control.
 */
async function composeDiscovery(db: Database, ctx: FounderContext): Promise<DiscoveryView> {
  const noteRows = await db
    .select()
    .from(founderMeetingNotes)
    .where(eq(founderMeetingNotes.prospectId, ctx.prospect.id))
    .orderBy(desc(founderMeetingNotes.createdAt));

  const meetingNotes: MeetingNoteView[] = [];
  for (const note of noteRows) {
    // An anonymised note's content is gone (0047's two-shape CHECK); the
    // prospect it belonged to is anonymised too, so the record view simply
    // omits it rather than rendering a row of blanks.
    if (note.anonymisedAt !== null) continue;
    meetingNotes.push({
      id: note.id,
      meetingDate:
        (note.meetingDate ? formatDay(new Date(`${note.meetingDate}T00:00:00Z`)) : null) ?? '',
      participants: note.participants ?? '',
      decisions: note.decisions ?? '',
      followUp: note.followUp ?? '',
      sourceLink: note.sourceLink ?? '',
      notes: note.notes,
      recordedBy: note.createdBy,
      recordedAt: formatInstant(note.createdAt) ?? '',
    });
  }

  const p = ctx.prospect;
  const evidence = Array.isArray(p.discoveryEvidence)
    ? (p.discoveryEvidence as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];

  return {
    fields: [
      { key: 'invitationSource', label: 'Discovery source', value: p.invitationSource, helper: null },
      { key: 'internalOwner', label: 'Internal owner', value: p.internalOwner, helper: null },
      { key: 'launchFrame', label: 'Launch frame', value: p.launchFrame, helper: null },
      { key: 'usAgeFit', label: 'US and 18+ fit', value: p.usAgeFit, helper: null },
      {
        key: 'deliveryFeasibility',
        label: 'Delivery feasibility',
        value: p.deliveryFeasibility,
        helper: null,
      },
      {
        key: 'compensationExpectations',
        label: 'Compensation expectations',
        value: p.compensationExpectations,
        helper: null,
      },
      {
        key: 'affiliateSourcingHypothesis',
        label: 'Creator-sourcing hypothesis',
        value: p.affiliateSourcingHypothesis,
        helper: null,
      },
      {
        key: 'adminNotes',
        label: 'Internal notes',
        value: p.adminNotes,
        helper: 'Internal to Proovd. Never rendered to the Founder, never read by the §9 prefill.',
      },
      {
        key: null,
        label: 'Last contact',
        value: p.lastContactAt ? formatInstant(p.lastContactAt) : null,
        helper: 'A record, never a schedule (§30).',
      },
    ],
    research: evidence,
    meetingNotes,
  };
}

/* ── Current-campaign facts (2026-08-16 rebuild) ───────────────────────────── */

/** The public page exists from launch onward (§18); before that there is none. */
function publicUrlOf(campaign: FounderCampaignRow['campaign']): string | null {
  return campaign.campaignLiveAt !== null ? `/campaign/${campaign.id}` : null;
}

/**
 * The Overview panel's live facts. Null when there is no current campaign;
 * counts are null before the campaign could have any (§16a: not yet populated
 * is not zero).
 */
async function composeCampaignFacts(
  db: Database,
  ctx: FounderContext,
  now: Date,
): Promise<CampaignFactsView | null> {
  const row = ctx.currentCampaign;
  if (!row) return null;
  const campaign = row.campaign;
  const launched = campaign.campaignLiveAt !== null;

  let activeBackers: number | null = null;
  let activeAffiliates: number | null = null;
  if (launched) {
    const [backerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(eq(reservations.campaignId, campaign.id), eq(reservations.status, 'reserved_active')),
      );
    activeBackers = backerCount?.count ?? 0;

    const [affiliateCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignAffiliateAssociations)
      .where(
        and(
          eq(campaignAffiliateAssociations.campaignId, campaign.id),
          eq(campaignAffiliateAssociations.status, 'active'),
        ),
      );
    activeAffiliates = affiliateCount?.count ?? 0;
  }

  return {
    campaignId: campaign.id,
    campaignDay: campaignDayOf(campaign.campaignLiveAt, now),
    liveAt: campaign.campaignLiveAt ? formatInstant(campaign.campaignLiveAt) : null,
    closesAt: campaign.campaignCloseAt ? formatInstant(campaign.campaignCloseAt) : null,
    discoveryOpenedAt: campaign.discoveryOpenedAt
      ? formatInstant(campaign.discoveryOpenedAt)
      : null,
    activeBackers,
    // The threshold is the Founder's own build value; an unset one stays null
    // and the surface says so rather than inventing a denominator.
    threshold: campaign.type === 'pre_build' ? (row.orderThreshold ?? null) : null,
    activeAffiliates,
    publicUrl: publicUrlOf(campaign),
  };
}

function setupStageOf(
  ctx: FounderContext,
  overview: OverviewPane,
): { stage: FounderSetupStage; detail: string | null } {
  const answered = overview.vetting.progress
    .slice(0, VETTING_STEP_LABELS.length)
    .filter((step) => step.done).length;

  return deriveSetupStage({
    invitationSent: overview.invitation.state !== 'Not sent',
    answered,
    total: VETTING_STEP_LABELS.length,
    signupComplete: ctx.accountUserId !== null,
  });
}

/**
 * Which menu actions this record's state actually permits.
 *
 * §1.1 requires server-side authorization and §1.4 forbids offering a control
 * that would do nothing, so the menu is decided here and the surface renders
 * what it is given. Every route re-decides independently — a hidden menu item
 * is not authorization.
 */
function availableActionsFor(
  ctx: FounderContext,
  invitationState: InvitationState,
): FounderMenuAction[] {
  const actions: FounderMenuAction[] = ['edit'];
  const draft = ctx.currentDraft;
  const sendable =
    draft !== null && draft.anonymisedAt === null && ctx.prospect.claimedAt === null;

  if (sendable && invitationState === 'Not sent') actions.push('sendinvite');
  if (sendable && invitationState !== 'Not sent') actions.push('newinvite');
  if (sendable && invitationLinkIsLive(invitationState)) actions.push('cancelinvite');

  if (ctx.accountState === 'Active') actions.push('suspend');
  if (ctx.accountState === 'Access suspended') actions.push('restore');
  if (ctx.accountUserId && !ctx.ban) actions.push('ban');

  actions.push('deletion');
  return actions;
}

/* ── Overview (§7, §9, §10) ────────────────────────────────────────────────── */

async function composeOverview(
  deps: FounderWorkspaceDeps,
  ctx: FounderContext,
  now: Date,
): Promise<OverviewPane> {
  const { db } = deps;
  const draft = ctx.currentDraft;

  const sends = draft
    ? await db
        .select({
          id: campaignInvitationSends.id,
          sentAt: campaignInvitationSends.sentAt,
          sentBy: campaignInvitationSends.sentBy,
          tokenVersion: campaignInvitationSends.tokenVersion,
          tokenExpiresAt: campaignInvitationSends.tokenExpiresAt,
        })
        .from(campaignInvitationSends)
        .where(eq(campaignInvitationSends.draftId, draft.id))
        .orderBy(desc(campaignInvitationSends.sentAt))
    : [];

  const tokens = draft
    ? await db
        .select({
          version: secureTokens.version,
          expiresAt: secureTokens.expiresAt,
          firstUsedAt: secureTokens.firstUsedAt,
          revokedAt: secureTokens.revokedAt,
          claimedAt: secureTokens.claimedAt,
        })
        .from(secureTokens)
        .where(
          and(
            eq(secureTokens.scope, 'founder_draft'),
            eq(secureTokens.campaignDraftId, draft.id),
          ),
        )
        .orderBy(desc(secureTokens.version))
    : [];

  const live = tokens.find((t) => t.revokedAt === null && t.claimedAt === null) ?? null;
  const openedAt = tokens.reduce<Date | null>(
    (earliest, token) =>
      token.firstUsedAt && (!earliest || token.firstUsedAt < earliest) ? token.firstUsedAt : earliest,
    null,
  );
  const revokedAt = tokens.reduce<Date | null>(
    (latest, token) => (token.revokedAt && (!latest || token.revokedAt > latest) ? token.revokedAt : latest),
    null,
  );

  const state: InvitationState = draft
    ? deriveInvitationState({
        draftStatus: draft.status,
        sendCount: sends.length,
        openedAt,
        claimedAt: ctx.prospect.claimedAt,
        tokenExpiresAt: live?.expiresAt ?? null,
        now,
      })
    : 'Not sent';

  const preview = draft
    ? await previewInvitation(db, draft.id, deps.invitationContext)
    : null;

  const names = await resolveActorNames(db, sends.map((s) => s.sentBy));

  const invitation: InvitationView = {
    state,
    stateAt: invitationStateAt(state, {
      sentAt: sends[0]?.sentAt ?? null,
      openedAt,
      claimedAt: ctx.prospect.claimedAt,
      revokedAt,
      expiresAt: live?.expiresAt ?? null,
    }),
    meaning: invitationMeaning(state, ctx.identity.preferredName || 'This Founder'),
    invitedBy: sends[0] ? actorName(names, sends[0].sentBy) : null,
    source: ctx.prospect.invitationSource,
    owner: ctx.prospect.internalOwner,
    overrides: overrideFieldsFor(ctx),
    content: FOUNDER_EDITABLE_FIELDS.filter((field) => field.group === 'invitation').map(
      (field) => ({
        key: field.key,
        label: field.label,
        value: invitationFieldValue(ctx, field.key),
        helper: field.helper ?? null,
      }),
    ),
    fixedContent: INVITATION_FIXED_CONTENT.map((entry) => ({
      key: entry.key,
      label: entry.label,
      // §7's two fixed promises ship as paragraph arrays in the template
      // module, because that is how the email renders them. The workspace shows
      // one read-only block, so they are joined here rather than each surface
      // deciding its own separator and drifting from what was actually sent.
      value: joinParagraphs(
        entry.key === 'invNext'
          ? PROCESS_SUMMARY
          : entry.key === 'invExpect'
            ? NO_GUARANTEE_TEXT
            : deps.invitationContext.supportEmail,
      ),
    })),
    unresolvedMarkers: preview?.unresolved ?? [],
    missingBeforeSend: preview?.missingFields ?? [],
    // The server's answer, and the send route re-decides it independently — a
    // disabled control is not authorization (§1.1).
    canSend: preview !== null && !preview.blocked && ctx.prospect.claimedAt === null,
    history: invitationHistory(ctx, sends, openedAt, revokedAt, names),
    technical: tokenFacts(live, tokens.length),
    facts: {
      sendCount: sends.length,
      tokenVersion: live?.version ?? tokens[0]?.version ?? null,
      // A sentence, not an instant: the state is what an Admin acts on, and
      // "Link inactive" covers expired, revoked, and claimed alike — which of
      // those it was is the history's job to say (§28.1 keeps enumeration out
      // of one-line summaries everywhere else; the same posture here).
      expiration: live
        ? live.expiresAt
          ? `Live until ${formatInstant(live.expiresAt) ?? live.expiresAt.toISOString()}`
          : 'Live'
        : sends.length > 0
          ? 'Link inactive'
          : 'No link issued yet',
      claimed: ctx.prospect.claimedAt
        ? `Recorded ${formatInstant(ctx.prospect.claimedAt) ?? ''}`.trim()
        : null,
      revoked: revokedAt !== null,
    },
  };

  const vetting = await composeVetting(db, ctx);

  return {
    invitation,
    vetting,
    accountCreatedAt: formatInstant(ctx.accountCreatedAt),
    signInMethod: ctx.signInMethod,
  };
}

function invitationStateAt(
  state: InvitationState,
  at: {
    sentAt: Date | null;
    openedAt: Date | null;
    claimedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
  },
): string | null {
  switch (state) {
    case 'Not sent':
      return null;
    case 'Invite accepted':
      return prefixed('Accepted', at.claimedAt);
    case 'Invite opened':
      return prefixed('Opened', at.openedAt);
    case 'Invite canceled':
      return prefixed('Canceled', at.revokedAt);
    case 'Invite expired':
      return prefixed('Expired', at.expiresAt);
    default:
      return prefixed('Sent', at.sentAt);
  }
}

function prefixed(word: string, at: Date | null): string | null {
  const rendered = formatInstant(at);
  return rendered ? `${word} ${rendered}` : null;
}

/**
 * The five §7 values an invitation may override, resolved for rendering.
 *
 * `value` is what THIS invitation will use; `profileValue` is what the Founder
 * profile says whether or not it is overridden. Both, always — an Admin looking
 * at a value that disagrees with the record needs to know which one is
 * authoritative (§26.2).
 */
function overrideFieldsFor(ctx: FounderContext): OverrideField[] {
  const draft = ctx.currentDraft;
  return PROFILE_OVERRIDE_FIELDS.map((field) => {
    const profileValue = profileValueForOverride(ctx, field.key);
    const override = draft ? (draft[field.column] as string | null) : null;
    const overridden = typeof override === 'string' && override.trim().length > 0;
    return {
      key: field.key,
      label: field.label,
      value: overridden ? override! : profileValue,
      profileValue,
      overridden,
      helper: overrideHelper(
        field.key,
        ctx.identity.preferredName || 'this Founder',
        overridden,
        profileValue,
      ),
    };
  });
}

function profileValueForOverride(ctx: FounderContext, key: ProfileOverrideKey): string {
  switch (key) {
    case 'recipientName':
      return ctx.identity.legalName;
    case 'recipientEmail':
      return ctx.identity.email;
    case 'recipientPhone':
      return ctx.identity.phone ?? '';
    case 'product':
      return ctx.prospect.productName ?? '';
    case 'website':
      return ctx.prospect.productUrl ?? '';
  }
}

/**
 * The invitation-group values, by register key.
 *
 * Three live on the draft (one invitation's content) and two on the prospect
 * (the provenance §7 requires a send row to store). The register groups all
 * five as `invitation` because that is what an Admin is editing; the columns
 * differ because the lifetimes do.
 */
function invitationFieldValue(ctx: FounderContext, key: string): string | null {
  switch (key) {
    case 'invSource':
      return ctx.prospect.invitationSource;
    case 'invOwner':
      return ctx.prospect.internalOwner;
    case 'invKnow':
      return ctx.currentDraft?.whatWeUnderstood ?? null;
    case 'invFit':
      return ctx.currentDraft?.whyInvited ?? null;
    case 'invTime':
      return ctx.currentDraft?.expectedSetupTime ?? null;
    default:
      return null;
  }
}

function invitationHistory(
  ctx: FounderContext,
  sends: ReadonlyArray<{ sentAt: Date; sentBy: string }>,
  openedAt: Date | null,
  revokedAt: Date | null,
  names: ReadonlyMap<string, string>,
): { at: string; title: string; body: string }[] {
  const entries: { at: Date; title: string; body: string }[] = [];
  const draft = ctx.currentDraft;

  if (draft) {
    entries.push({
      at: draft.createdAt,
      title: 'Invite created',
      body: `Created by ${actorName(names, draft.createdBy) ?? draft.createdBy}.`,
    });
  }

  const ascending = [...sends].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  ascending.forEach((send, index) => {
    entries.push({
      at: send.sentAt,
      title: index === 0 ? 'Invite sent' : 'New invite sent',
      body:
        index === 0
          ? `Invitation sent to ${ctx.identity.email}.`
          : 'A new invitation was sent. The previous invitation link stopped working.',
    });
  });

  if (openedAt) {
    entries.push({
      at: openedAt,
      title: 'Invite opened',
      body: `${ctx.identity.preferredName} opened the Founder setup.`,
    });
  }
  if (ctx.prospect.claimedAt) {
    entries.push({
      at: ctx.prospect.claimedAt,
      title: 'Invite accepted',
      body: `${ctx.identity.preferredName} completed the invitation account-claim step.`,
    });
  }
  if (revokedAt) {
    entries.push({
      at: revokedAt,
      title: 'Invite canceled',
      body: 'Proovd canceled this invitation. Its link no longer works.',
    });
  }

  return entries
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((entry) => ({
      at: formatInstant(entry.at) ?? entry.at.toISOString(),
      title: entry.title,
      body: entry.body,
    }));
}

/**
 * Token facts, never a token value (§28.1).
 *
 * The raw value exists in the delivered URL and nowhere else — not at rest, not
 * in a log, not in an error, and not here. An Admin who needs a Founder to have
 * a working link sends a new one.
 */
function tokenFacts(
  live: { version: number; expiresAt: Date | null } | null,
  total: number,
): string {
  if (total === 0) return 'No token exists yet — one is created when the invitation is sent.';
  if (!live) {
    return `No live token · ${total} version${total === 1 ? '' : 's'} issued · only the hash was ever stored · raw link never logged.`;
  }
  const expiry = formatDay(live.expiresAt);
  return [
    `Token v${live.version}`,
    'only the hash is stored',
    total > 1 ? 'previous versions revoked on each resend' : null,
    expiry ? `expires ${expiry}` : null,
    'raw link never logged',
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

async function composeVetting(db: Database, ctx: FounderContext): Promise<VettingView> {
  const draft = ctx.currentDraft;
  const campaign = ctx.currentCampaign?.campaign ?? null;

  const [row] = draft
    ? await db
        .select()
        .from(campaignVetting)
        .where(eq(campaignVetting.draftId, draft.id))
        .limit(1)
    : [];

  const answers: Array<{ key: 'problem' | 'solution' | 'views' | 'competition'; text: string | null }> = [
    { key: 'problem', text: row?.problemText ?? null },
    { key: 'solution', text: row?.solutionText ?? null },
    { key: 'competition', text: row?.competitionText ?? null },
  ];
  // The amount of views was asked between 2026-08-10 and 2026-08-18 only. A
  // stored answer still renders — it is the Founder's own and Admin reads it —
  // and a campaign onboarded after the retirement renders the ABSENCE by name
  // rather than a blank row, because "nobody was asked" and "asked and left
  // empty" are different facts (§16a, §1.4).
  if (row?.viewsRange != null) {
    answers.push({ key: 'views', text: VIEWS_RANGE_LABELS[row.viewsRange] ?? null });
  } else {
    answers.push({ key: 'views', text: VIEWS_NOT_COLLECTED_LABEL });
  }

  const done = [
    present(row?.problemText),
    present(row?.solutionText),
    present(row?.competitionText),
  ];

  const signal = campaign ? await readPossibleCreatorSignal(db, campaign.id) : null;

  // Annotated rather than inferred: `.map` over a `as const` label tuple infers
  // the narrow literal union, and the two steps pushed below are not members of
  // it — §10's Creator-matches step and the account creation.
  const progress: { label: string; done: boolean }[] = VETTING_STEP_LABELS.map(
    (label, index) => ({
      label: label as string,
      done: done[index] ?? false,
    }),
  );
  progress.push({ label: CREATOR_MATCH_STEP_LABEL, done: signal !== null });
  progress.push({ label: ACCOUNT_CREATED_STEP_LABEL, done: ctx.accountUserId !== null });

  const answeredCount = done.filter(Boolean).length;

  return {
    progress,
    progressStatus:
      ctx.accountUserId !== null && answeredCount === VETTING_STEP_LABELS.length
        ? 'Setup complete'
        : answeredCount === 0
          ? 'Not started'
          : `${answeredCount} of ${VETTING_STEP_LABELS.length} questions completed`,
    campaignType: campaignTypeLabel(campaign?.type ?? null),
    campaignTypeAt: campaign?.typeLockedAt
      ? `${prefixed('Confirmed', campaign.typeLockedAt)} · ${CAMPAIGN_TYPE_LOCK_NOTE}`
      : null,
    // The simplified flow: Admin chooses the path from discovery, and it stays
    // changeable until the Founder submits — which is when it locks above.
    campaignTypeSelected: campaignTypeLabel(row?.selectedType ?? null),
    campaignTypeSelectedRaw: (row?.selectedType as 'pre_build' | 'pre_launch' | null) ?? null,
    campaignTypeEditable: draft !== null && !campaign?.typeLockedAt && !row?.submittedAt,
    /** The draft the campaign-path control writes against. */
    draftId: draft?.id ?? null,
    answers: answers.map((answer) => ({
      key: answer.key,
      label: VETTING_ANSWER_LABELS[answer.key],
      text: answer.text,
      provenance: provenanceOf(answer.key, row, ctx.identity.preferredName),
      // Problem and Solution take §9's Admin prefill until submission locks
      // the record — and only while the Founder has not taken the field over,
      // because after that the prefill route deliberately leaves their words
      // alone and a control that visibly changes nothing is a defect report
      // waiting to be filed. Views is the Founder's own choice with no prefill
      // path, and Competition is §33.1.5's absence: neither is ever editable.
      editable:
        (answer.key === 'problem' || answer.key === 'solution') &&
        draft !== null &&
        !row?.submittedAt &&
        !(answer.key === 'problem' ? row?.problemFirstEditedAt : row?.solutionFirstEditedAt),
    })),
    lastSaved: prefixed('Last successful save:', row?.lastSavedAt ?? null),
    // §10: `null` means never recorded, which is NOT zero — and Admin is the
    // one audience allowed to see a recorded zero. The assessment no longer
    // blocks the Founder's claim; it remains a recordable fact.
    creatorMatches: signal
      ? { count: signal.count, recordedAt: formatInstant(new Date(signal.recordedAt)) }
      : null,
  };
}

const VETTING_ANSWER_LABELS: Record<'problem' | 'solution' | 'views' | 'competition', string> = {
  problem: 'Problem',
  solution: 'Solution',
  views: 'Amount of views',
  competition: 'Competition and alternatives',
};

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * §9's provenance, rendered.
 *
 * Competition can only ever say "Written by …" — there is no prefill column for
 * it, no prefill parameter, and a CHECK constraint pinning its supplier
 * (§33.1.5). The shape of this function is the third place that is true.
 */
function provenanceOf(
  key: 'problem' | 'solution' | 'views' | 'competition',
  row: typeof campaignVetting.$inferSelect | undefined,
  preferredName: string,
): string | null {
  if (!row) return null;
  if (key === 'views') {
    // No provenance line where nothing was collected: the row already says so,
    // and "Chosen by X" over an absence would attribute an answer nobody gave.
    return row.viewsRange !== null ? `Chosen by ${preferredName}` : null;
  }
  if (key === 'competition') {
    return present(row.competitionText) ? `Written by ${preferredName}` : null;
  }
  const text = key === 'problem' ? row.problemText : row.solutionText;
  if (!present(text)) return null;

  const prefilledAt = key === 'problem' ? row.problemPrefilledAt : row.solutionPrefilledAt;
  const lastEditedAt = key === 'problem' ? row.problemLastEditedAt : row.solutionLastEditedAt;
  const supplier = key === 'problem' ? row.problemSupplier : row.solutionSupplier;

  if (!prefilledAt) return `Written by ${preferredName}`;
  return supplier === 'founder' && lastEditedAt
    ? `Originally prepared by Proovd · Last edited by ${preferredName}`
    : 'Originally prepared by Proovd';
}

/* ── Details (§25.5, §25.6, §26.7, §25.8) ─────────────────────────────────── */

async function composeDetails(db: Database, ctx: FounderContext): Promise<DetailsPane> {
  const field = (key: string, value: string | null): DetailField => {
    const registered = FOUNDER_EDITABLE_FIELDS.find((f) => f.key === key);
    return {
      key,
      label: registered?.label ?? key,
      value,
      helper: registered?.helper ?? null,
      // Every registered field is editable at every stage: migration 0043 gave
      // the identity/business fields a pre-claim home on the prospect, and the
      // claim profile wins wherever it holds a value. The gate difference is
      // the reason and freshness §25.6 demands once the account is claimed —
      // decided by `editReasonRequired`, not by hiding the control.
      editable: registered !== undefined,
    };
  };

  const personal: DetailField[] = [
    field('preferred', ctx.identity.preferredName || null),
    field('legal', ctx.identity.legalName || null),
    field('email', ctx.identity.email || null),
    field('phone', ctx.identity.phone),
    // The raw YYYY-MM-DD rather than a formatted day, because the edit dialog
    // prefills from this value and the save path only accepts the ISO shape —
    // a value that cannot round-trip through its own Edit control is a trap.
    field('dob', ctx.claim?.dateOfBirth ?? ctx.prospect.dateOfBirth ?? null),
    field('state', ctx.identity.state),
    field('country', ctx.identity.country),
    {
      key: 'age',
      label: 'Age',
      value: ctx.claim?.representationAge18Plus ? 'Confirmed 18 or older' : 'Not confirmed yet',
      helper: 'The Founder’s own §28.4 representation, recorded at account creation.',
      // Not an Admin field, and never one: this records what the FOUNDER
      // stated, and an Admin writing it would manufacture a representation
      // nobody made (§28.4).
      editable: false,
    },
  ];

  const business: DetailField[] = [
    field('bizType', ctx.claim?.businessEntityType ?? ctx.prospect.businessEntityType ?? null),
    field('bizLegal', ctx.identity.businessName),
    field('product', ctx.prospect.productName),
    field('website', ctx.prospect.productUrl),
  ];

  const [digest] = ctx.accountUserId
    ? await db
        .select({ frequency: notificationDigestPreferences.frequency })
        .from(notificationDigestPreferences)
        .where(eq(notificationDigestPreferences.userId, ctx.accountUserId))
        .limit(1)
    : [];

  const preferences: DetailField[] = [
    {
      key: 'summary',
      label: 'Activity summary',
      // §27.7's preference exists only because a person chose it, and §30
      // forbids the product answering for them. Read-only is the honest form.
      value: digest ? DIGEST_LABELS[digest.frequency] ?? digest.frequency : SUMMARY_NOT_CHOSEN_LABEL,
      helper: SUMMARY_IS_NOT_ADMIN_WRITABLE,
      editable: false,
    },
    {
      key: 'requiredEmails',
      label: 'Required emails',
      value: REQUIRED_EMAILS_LABEL,
      helper: REQUIRED_EMAILS_HELPER,
      editable: false,
    },
  ];

  const requests = await db
    .select()
    .from(founderDeletionRequests)
    .where(eq(founderDeletionRequests.prospectId, ctx.prospect.id))
    .orderBy(desc(founderDeletionRequests.requestedAt))
    .limit(1);

  const latestRequest = requests[0] ?? null;
  const reviews = latestRequest
    ? await db
        .select()
        .from(founderDeletionReviews)
        .where(eq(founderDeletionReviews.requestId, latestRequest.id))
        .orderBy(desc(founderDeletionReviews.occurredAt))
    : [];

  const reviewActors = await resolveActorNames(db, reviews.map((r) => r.actor));

  return {
    personal,
    business,
    preferences,
    standing: standingOf(ctx),
    ban: ctx.ban
      ? {
          trigger:
            GHOST_BAN_TRIGGER_LABELS[ctx.ban.trigger as GhostBanTrigger] ?? ctx.ban.trigger,
          decidedAt: formatInstant(ctx.ban.decidedAt) ?? ctx.ban.decidedAt.toISOString(),
          notice: ctx.ban.notice,
        }
      : null,
    deletionRequest: latestRequest
      ? {
          id: latestRequest.id,
          // §25.8: closing an account does not end the retention obligations,
          // and the surface says so where somebody might assume otherwise.
          detail: `${latestRequest.requestDetail} ${DELETION_RETENTION_NOTE}`,
          requestedAt:
            formatInstant(latestRequest.requestedAt) ?? latestRequest.requestedAt.toISOString(),
          receivedVia: latestRequest.receivedVia,
          reviews: reviews.map((review) => ({
            note: review.note,
            actor: actorName(reviewActors, review.actor) ?? review.actor,
            at: formatInstant(review.occurredAt) ?? review.occurredAt.toISOString(),
          })),
        }
      : null,
  };
}

const DIGEST_LABELS: Record<string, string> = {
  off: 'No activity summary',
  daily: 'Daily summary',
  weekly: 'Weekly summary',
};

function standingOf(ctx: FounderContext): DetailsPane['standing'] {
  if (ctx.ban) {
    return {
      value: 'Permanently banned',
      detail: ctx.ban.notice,
      owner: null,
      startedAt: formatInstant(ctx.ban.decidedAt),
      // §22.7 states the ban is permanent and names no reversal, so there is
      // no next review to promise (§1.4).
      nextReviewAt: null,
    };
  }
  const latest = ctx.latestAccess;
  if (latest?.action === 'suspend') {
    return {
      value: 'Under review',
      detail: latest.reason,
      owner: latest.reviewOwner,
      startedAt: formatInstant(latest.occurredAt),
      nextReviewAt: formatInstant(latest.nextReviewAt),
    };
  }
  return {
    value: 'No issues',
    detail: null,
    owner: null,
    startedAt: null,
    nextReviewAt: null,
  };
}

/* ── Campaigns (§23.1, §23.2, §15, §22.10) ────────────────────────────────── */

async function composeCampaigns(
  db: Database,
  ctx: FounderContext,
  now: Date,
): Promise<CampaignsPane> {
  const current = ctx.currentCampaign
    ? await composeCurrentCampaign(db, ctx, ctx.currentCampaign)
    : null;

  const previous: PreviousCampaign[] = [];
  for (const row of ctx.previousCampaigns) {
    previous.push({
      campaignId: row.campaign.id,
      name: campaignNameOf(row.title, ctx.prospect.productName),
      type: campaignTypeLabel(row.campaign.type) ?? 'Campaign type not confirmed',
      status: campaignStatusLabel(row.campaign.status),
      lines: await previousCampaignLines(db, row),
    });
  }

  return { current, previous, next: await composeNextCampaign(db, ctx, now) };
}

async function composeCurrentCampaign(
  db: Database,
  ctx: FounderContext,
  row: FounderCampaignRow,
): Promise<CampaignSummary> {
  const campaign = row.campaign;

  const [review] = await db
    .select()
    .from(campaignReviews)
    .where(eq(campaignReviews.campaignId, campaign.id))
    .orderBy(desc(campaignReviews.round))
    .limit(1);

  const feedback = review
    ? await db
        .select({ body: reviewFeedbackItems.body, group: reviewFeedbackItems.feedbackGroup })
        .from(reviewFeedbackItems)
        .where(eq(reviewFeedbackItems.reviewId, review.id))
    : [];

  const [listing] = await db
    .select({ totalCents: listingFeePayments.totalCents })
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, campaign.id))
    .limit(1);

  return {
    campaignId: campaign.id,
    name: campaignNameOf(row.title, ctx.prospect.productName),
    type: campaignTypeLabel(campaign.type) ?? 'Campaign type not confirmed',
    status: campaignStatusLabel(campaign.status),
    rawStatus: campaign.status,
    buildStatus: BUILD_STATUS_LABELS[campaign.campaignBuildStatus] ?? null,
    rosterReadiness: ROSTER_STATUS_LABELS[campaign.affiliateRosterStatus] ?? null,
    review: review
      ? {
          outcome: REVIEW_OUTCOME_LABELS[review.outcome] ?? review.outcome,
          why:
            review.outcome === 'changes_required'
              ? (feedback
                  .filter((item) => item.group === 'required')
                  .map((item) => item.body)
                  .join(' ') || null)
              : null,
        }
      : null,
    listing: listing ? `Paid · ${formatUsdCents(listing.totalCents)}` : null,
    opensAt: formatInstant(campaign.campaignLiveAt),
    closesAt: formatInstant(campaign.campaignCloseAt),
    issue: await campaignIssueOf(db, campaign),
  };
}

const REVIEW_OUTCOME_LABELS: Record<string, string> = {
  pending: 'Waiting for Proovd review',
  approved: 'Approved',
  changes_required: 'Changes requested by Proovd',
};

/**
 * The one thing standing in this campaign's way, or nothing.
 *
 * Every branch names a recorded fact: an enforcement action's own customer
 * explanation, a review outcome, or a count of associations sitting in a §14.2
 * decision state. Nothing here invents a deadline or a condition (§1 rule 6).
 */
async function campaignIssueOf(
  db: Database,
  campaign: typeof campaigns.$inferSelect,
): Promise<string | null> {
  if (campaign.status === 'suspended' || campaign.status === 'killed') {
    const [action] = await db
      .select({ explanation: campaignEnforcementActions.customerExplanation })
      .from(campaignEnforcementActions)
      .where(eq(campaignEnforcementActions.campaignId, campaign.id))
      .orderBy(desc(campaignEnforcementActions.occurredAt))
      .limit(1);
    return action?.explanation ?? campaignStatusLabel(campaign.status);
  }

  if (campaign.status === 'changes_required') {
    return 'Proovd requested changes before this campaign can be approved.';
  }
  if (campaign.status === 'pending_review') {
    return 'This campaign is waiting for Proovd review.';
  }
  if (campaign.status === 'creator_replacement') {
    return 'A required Creator did not deliver, and a replacement is being found.';
  }
  if (campaign.status === 'affiliate_response_and_build') {
    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignAffiliateAssociations)
      .where(
        and(
          eq(campaignAffiliateAssociations.campaignId, campaign.id),
          inArray(campaignAffiliateAssociations.status, [
            'formal_decision_open',
            'reviewing',
            'proposal_pending',
          ] as never[]),
        ),
      );
    const count = pending?.count ?? 0;
    if (count > 0) {
      return `${count} Creator ${count === 1 ? 'proposal is' : 'proposals are'} still waiting for final decisions.`;
    }
  }
  return null;
}

/**
 * Result lines for a campaign that is behind this one.
 *
 * Empty when the phase that would produce them has not run — §16a's rule: a
 * campaign whose close batch never ran has a 0 in every ledger column, and
 * `US$0.00 captured` is a different claim from "nothing has been counted yet".
 */
async function previousCampaignLines(
  db: Database,
  row: FounderCampaignRow,
): Promise<string[]> {
  const campaign = row.campaign;
  const lines: string[] = [];

  if (campaign.archivedAt) {
    lines.push('Archived — a fresh setup was started for this Founder.');
    return lines;
  }

  const counts = await db
    .select({
      status: sql<string>`${reservations.status}::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaign.id))
    .groupBy(sql`${reservations.status}::text`);

  const byStatus = new Map(counts.map((entry) => [entry.status, entry.count]));
  const captured = byStatus.get('captured') ?? 0;

  if (campaign.rewardSubtotalCapturedCents > 0n) {
    lines.push(`${captured} Backer${captured === 1 ? '' : 's'} charged`);
    lines.push(`${formatUsdCents(campaign.rewardSubtotalCapturedCents)} captured reward subtotal`);
  } else if (campaign.status === 'ended_no_charge') {
    const active = (byStatus.get('threshold_not_met_no_charge') ?? 0) + (byStatus.get('reserved_active') ?? 0);
    lines.push(`${active} active Backer${active === 1 ? '' : 's'} at close`);
    if (campaign.type === 'pre_build' && row.orderThreshold !== null) {
      lines.push(`Order threshold: ${row.orderThreshold}`);
    }
  }

  const [fulfillment] = await db
    .select({ deliveredAt: campaignFulfillment.deliveredAt })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, campaign.id))
    .limit(1);

  if (fulfillment?.deliveredAt) lines.push('Delivered');

  return lines;
}

/**
 * §22.10's two independent gates, over the most recently CLOSED campaign.
 *
 * Null when nothing has closed: the cooldown is a function of
 * `campaign_close_at`, and a page that showed a wait with no anchor would be
 * showing a number derived from nothing.
 */
async function composeNextCampaign(
  db: Database,
  ctx: FounderContext,
  now: Date,
): Promise<CampaignsPane['next']> {
  const closed = ctx.campaignRows
    .filter((row) => row.campaign.campaignCloseAt !== null && row.campaign.archivedAt === null)
    .sort(
      (a, b) =>
        (b.campaign.campaignCloseAt?.getTime() ?? 0) - (a.campaign.campaignCloseAt?.getTime() ?? 0),
    )[0];

  if (!closed) return null;

  const view = await readNextCampaignReadiness(db, closed.campaign.id, now);
  const earliest = view.cooldown.earliestAt ? new Date(view.cooldown.earliestAt) : null;
  const remaining = daysUntil(earliest, now);

  return {
    earliest: formatDay(earliest),
    wait: view.cooldown.blocker
      ? null
      : remaining === null
        ? 'The wait has passed'
        : `${remaining} day${remaining === 1 ? '' : 's'} remaining`,
    readiness:
      view.adminReadiness.decision === 'ready'
        ? 'Ready for another campaign'
        : view.adminReadiness.decision === 'not_ready'
          ? 'Not ready yet'
          : 'Not reviewed yet',
    readinessNote: view.adminReadiness.explanation ?? view.cooldown.blocker,
    canApprove: view.adminReadiness.decision !== 'ready',
    canRemoveApproval: view.adminReadiness.decision === 'ready',
  };
}

/* ── Money (§13, §24.6, §22.3, §12) ───────────────────────────────────────── */

async function composeMoney(
  deps: FounderWorkspaceDeps,
  ctx: FounderContext,
  paymentStatuses: ReadonlyMap<string, FounderPaymentStatusView | null>,
): Promise<MoneyPane> {
  const { db } = deps;
  const name = ctx.identity.preferredName || 'This Founder';

  /* Stripe onboarding — the ONE resolver, not a second reading of the row. */
  let setup: MoneyPane['setup'] = {
    value: STRIPE_UNCONFIGURED,
    body: STRIPE_UNCONFIGURED_BODY,
    action: null,
  };
  let identity: MoneyPane['identity'] = {
    value: STRIPE_UNCONFIGURED,
    helper: IDENTITY_CHECK_HELPER,
  };
  let stripe: MoneyPane['stripe'] = null;

  if (deps.onboarding && !ctx.accountUserId) {
    // Configured, but nobody to look up. Not "Not started" as a claim about
    // Stripe — there is no person yet for Stripe to have a view of.
    setup = {
      value: PAYMENT_SETUP_LABELS['not_started']!,
      body: `${name} has not created a Proovd account yet, so no payment setup exists.`,
      action: null,
    };
    identity = { value: IDENTITY_LABELS['not_started']!, helper: IDENTITY_CHECK_HELPER };
  } else if (deps.onboarding && ctx.accountUserId) {
    const view = await readOnboardingState(deps.onboarding, {
      ownerUserId: ctx.accountUserId,
      role: 'founder_seller',
    });

    setup = {
      value: PAYMENT_SETUP_LABELS[view.state] ?? view.state,
      body: (SETUP_BODIES[view.state] ?? (() => STRIPE_UNCONFIGURED_BODY))(name),
      // §13: restricted offers a support path, never another attempt. The one
      // action an Admin has is to look at what Stripe said, and the surface
      // parks it (`PARKED_MESSAGES.stripeHosted`) rather than pretending
      // Proovd can lift a provider restriction.
      action: view.state === 'restricted' ? 'View restriction' : null,
    };
    identity = { value: IDENTITY_LABELS[view.state] ?? view.state, helper: IDENTITY_CHECK_HELPER };

    const row = await findAccountForOwner(db, {
      ownerUserId: ctx.accountUserId,
      role: 'founder_seller',
      mode: deps.onboarding.gateway.mode,
    });

    if (row) {
      stripe = {
        accountId: row.stripeAccountId,
        requirements: view.missingRequirements.length
          ? view.missingRequirements.join(' · ')
          : 'None',
        lastUpdated: formatInstant(row.lastSyncedAt),
        capability: capabilityLine(row.capabilities),
      };
    }
  }

  /* §24.6's listing stream — the payment row's own stored lines. */
  const campaignIds = ctx.campaignRows.map((row) => row.campaign.id);
  const listingRows = campaignIds.length
    ? await db
        .select()
        .from(listingFeePayments)
        .where(inArray(listingFeePayments.campaignId, campaignIds))
    : [];

  const refunded = new Set(
    listingRows.length
      ? (
          await db
            .select({ paymentId: listingFeeRefunds.paymentId })
            .from(listingFeeRefunds)
            .where(
              inArray(
                listingFeeRefunds.paymentId,
                listingRows.map((row) => row.id),
              ),
            )
        ).map((row) => row.paymentId)
      : [],
  );

  const listings: MoneyPane['listings'] = listingRows.map((payment) => {
    const campaign = ctx.campaignRows.find((row) => row.campaign.id === payment.campaignId);
    const lines: MoneyPane['listings'][number]['lines'] = [
      { label: 'Starting listing fee', amount: formatUsdCents(payment.baseCents), sub: false },
    ];
    for (const line of discountLinesOf(payment.discountLines)) {
      lines.push({
        label: `${OPTIONAL_ITEM_LABELS[line.item] ?? line.item} completed`,
        amount: `−${formatUsdCents(line.discountCents)}`,
        sub: true,
      });
    }
    lines.push({ label: 'Listing-fee subtotal', amount: formatUsdCents(payment.subtotalCents), sub: false });
    lines.push({ label: 'Sales tax', amount: formatUsdCents(payment.taxCents), sub: false });
    lines.push({ label: 'Total paid', amount: formatUsdCents(payment.totalCents), sub: false });

    return {
      campaignId: payment.campaignId,
      campaignName: campaignNameOf(campaign?.title ?? null, ctx.prospect.productName),
      lines,
      status: refunded.has(payment.id) ? 'Refunded' : 'Paid',
    };
  });

  /* §22.3 — one resolver, many renderers (§33.8.13). */
  const applicable = ctx.campaignRows
    .map((row) => ({ row, status: paymentStatuses.get(row.campaign.id) ?? null }))
    .filter((entry): entry is { row: FounderCampaignRow; status: FounderPaymentStatusView } =>
      entry.status !== null,
    );

  const live = applicable.filter((entry) => entry.status.applicable);

  const w9Source = live[0]?.status ?? applicable[0]?.status ?? null;
  const w9: MoneyPane['w9'] = w9Source
    ? {
        value: W9_VALUE_LABELS[w9Source.w9.state] ?? w9Source.w9.state,
        line: w9Source.w9.line,
        // The W-9 request and its verification are the close queue's routes
        // (§22.3, Phase 19b). Offering a second control here that posted
        // somewhere else would be a second door onto a money decision.
        action: null,
      }
    : {
        value: 'Not requested',
        line: 'A W-9 is requested after a campaign closes with captured charges. None has closed yet.',
        action: null,
      };

  const paymentRows = live.flatMap((entry) =>
    entry.status.payments.map((line) => ({
      campaignName: campaignNameOf(entry.row.title, ctx.prospect.productName),
      label: line.label,
      amount: formatUsdCents(BigInt(line.amountCents)),
      status: PAYMENT_STATUS_LABELS[line.status],
      line: paymentLineOf(line, entry.status),
    })),
  );

  const payments: MoneyPane['payments'] =
    live.length > 0
      ? { populated: true, waitingOn: null, value: paymentRows }
      : {
          populated: false,
          waitingOn:
            applicable[0]?.status.notApplicableReason ??
            'Founder payments begin after a campaign closes and charges settle (§22.3).',
          value: null,
        };

  const blockers: MoneyPane['blockers'] = live.flatMap((entry) =>
    entry.status.payments
      .filter((line) => line.status === 'blocked' && line.blockers.length > 0)
      .map((line) => ({
        amount: formatUsdCents(BigInt(line.amountCents)),
        state: 'not ready yet',
        reason: line.amountExact
          ? line.blockers.join(' ')
          : `${line.blockers.join(' ')} The amount shown is the minimum until every provisional Creator amount resolves (§24.4).`,
        owner: line.secureAction ? ctx.identity.preferredName || 'The Founder' : 'Proovd',
        action: line.secureAction ?? 'No action needed',
        nextReview: entry.status.nextReviewDate
          ? formatInstant(new Date(entry.status.nextReviewDate))
          : null,
      })),
  );

  return {
    setup,
    identity,
    stripe,
    listings,
    w9,
    payments,
    blockers,
    pricing: await composePricing(db, ctx),
  };
}

const W9_VALUE_LABELS: Record<string, string> = {
  not_requested: 'Not requested',
  requested: 'Needed',
  submitted: 'Submitted',
  verified: 'Verified',
};

const PAYMENT_STATUS_LABELS: Record<'blocked' | 'eligible' | 'released', string> = {
  blocked: 'Not ready yet',
  eligible: 'Ready to release',
  released: 'Sent',
};

function paymentLineOf(
  line: FounderPaymentStatusView['payments'][number],
  status: FounderPaymentStatusView,
): string {
  if (line.status === 'released') {
    return `Sent ${formatInstant(line.releasedAt ? new Date(line.releasedAt) : null) ?? 'on the recorded date'}.`;
  }
  if (line.status === 'eligible') {
    return `Due ${formatInstant(new Date(line.dueAt)) ?? 'on the recorded date'}. Proovd records the release decision.`;
  }
  return line.blockers[0] ?? status.eligibleShare.note;
}

interface StoredDiscountLine {
  item: string;
  discountCents: bigint;
}

/**
 * The stored discount lines, read back as money.
 *
 * `discount_lines` is `jsonb`, so the cents arrive as whatever JSON could carry
 * — a string on the way out of `bigint`. Coercing through `BigInt` keeps the
 * one integer-cents rule (tech-stack §4.1) rather than letting a float in
 * through the back door.
 */
function discountLinesOf(value: unknown): StoredDiscountLine[] {
  if (!Array.isArray(value)) return [];
  const lines: StoredDiscountLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const item = record['item'];
    const cents = record['discountCents'];
    if (typeof item !== 'string') continue;
    if (typeof cents !== 'string' && typeof cents !== 'number' && typeof cents !== 'bigint') continue;
    lines.push({ item, discountCents: BigInt(cents) });
  }
  return lines;
}

function capabilityLine(capabilities: unknown): string {
  if (typeof capabilities !== 'object' || capabilities === null) return 'Not reported';
  const entries = Object.entries(capabilities as Record<string, unknown>);
  if (entries.length === 0) return 'Not reported';
  return entries.map(([name, value]) => `${name}: ${String(value)}`).join(' · ');
}

/**
 * §12's high-effort classification, which decides one commercial thing: whether
 * a Creator may propose above the base percentage (§14.3).
 *
 * `null` when nothing has been classified — not "standard pricing", which would
 * be a claim about a campaign nobody has evaluated.
 */
async function composePricing(db: Database, ctx: FounderContext): Promise<MoneyPane['pricing']> {
  const campaign = ctx.currentCampaign?.campaign ?? null;
  if (!campaign || campaign.highEffort === null) return null;

  const [classification] = await db
    .select()
    .from(highEffortClassifications)
    .where(eq(highEffortClassifications.campaignId, campaign.id))
    .orderBy(desc(highEffortClassifications.calculatedAt))
    .limit(1);

  if (!classification) return null;

  if (!classification.highEffort) {
    return {
      value: 'Standard Creator pricing applies',
      reasons: null,
      note: campaign.listingPaidAt
        ? 'This reflects the locked campaign calculation.'
        : 'This can still change while the campaign is being prepared.',
    };
  }

  const reasons: string[] = [];
  if (!classification.visualsCompleted) reasons.push('Campaign visuals not completed');
  if (!classification.brandingCompleted) reasons.push('Branding not completed');
  if (!classification.interviewScheduledOrConfirmed) reasons.push('Founder interview not scheduled');

  return {
    value: 'Creators may propose a higher percentage',
    reasons,
    note: campaign.listingPaidAt ? 'This reflects the locked campaign calculation.' : null,
  };
}

/* ── Guards the routes read ────────────────────────────────────────────────── */

/**
 * Whether this person has a draft that could still carry an invitation.
 *
 * Used by the routes before they call the §7 services, so a refusal names the
 * reason rather than surfacing a null-dereference from two layers down.
 */
export function invitableDraftOf(ctx: FounderContext): CampaignDraft | null {
  const draft = ctx.currentDraft;
  if (!draft || draft.anonymisedAt !== null) return null;
  return draft;
}

/**
 * One read-only block from §7's fixed invitation copy.
 *
 * `PROCESS_SUMMARY` and `NO_GUARANTEE_TEXT` are paragraph arrays in the
 * template module because that is how the email renders them. The workspace
 * shows the Admin one block of what will go out, so the join happens here —
 * once — rather than each surface picking its own separator and drifting from
 * the delivered wording.
 */
function joinParagraphs(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n\n') : (value as string);
}
