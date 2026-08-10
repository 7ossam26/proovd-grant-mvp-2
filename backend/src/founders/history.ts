/**
 * The Founder-scoped history feed — Spec §26.1, §26.8, §25.6.
 *
 * ── This composes. It does not store ────────────────────────────────────────
 * `support/timeline.ts` records why at length and the reason applies here
 * unchanged: a second event store that drifts from the first is worse than no
 * feed at all. So every entry below is read out of the record that already owns
 * the fact, and carries the name of the table it came from — which makes the
 * claim checkable from the response rather than a promise in a comment. There
 * is no `founder_history` table and there must never be one.
 *
 * ── Why this is not §26.8's timeline ────────────────────────────────────────
 * §26.8's timeline is campaign-, reservation-, and association-scoped. A person
 * outlives all three: an archived-and-restarted Founder has two campaigns and
 * one relationship, and their invitation sends, W-9 events, Stripe account
 * events, access decisions, and account-closure request belong to none of the
 * three subjects that timeline accepts. So the feed is its own read with its
 * own vocabulary (`FOUNDER_HISTORY_CATEGORIES`), and the composer maps records
 * onto it rather than reusing a subject that cannot hold them.
 *
 * ── The audit-action allowlist is an enumeration, not a filter ──────────────
 * `audit_events` doubles many of the records below — `invitation.sent` beside
 * the send row, `founder_payments.w9_verified` beside the W-9 event — and
 * rendering both would show an Admin the same thing twice. So only the actions
 * with no first-class record here are read, and each one is mapped to a title
 * BY NAME. An unmapped action is skipped: falling back to rendering the raw
 * action string would put `vetting.possible_creator_result_recorded` on a
 * surface that gets read aloud on a support call (§3.1), and a title somebody
 * has to decide is a title somebody should decide.
 */

import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { FounderHistoryEntry } from './types.js';
import type { FounderHistoryCategory } from './logic.js';
import { campaignStatusLabel } from './logic.js';
import { actorName, formatInstant, resolveActorNames } from './format.js';
import {
  FOUNDER_ACCESS_RECORDED,
  FOUNDER_DELETION_REQUESTED,
  FOUNDER_DELETION_REVIEWED,
  FOUNDER_FIELD_UPDATED,
  FOUNDER_OVERRIDE_CLEARED,
  FOUNDER_OVERRIDE_SET,
  FOUNDER_SENDER_RECORDED,
  isFieldEditAuditValue,
} from './audit-actions.js';

import { campaignStatusHistory } from '../db/schema/domain.js';
import { campaignInvitationSends } from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import { auditEvents } from '../db/schema/integrity.js';
import { adminOverrides } from '../db/schema/admin-operations.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { founderPayments, founderW9Events } from '../db/schema/founder-payments.js';
import { stripeAccountEvents, stripeConnectedAccounts } from '../db/schema/payments.js';
import { supportCases } from '../db/schema/support.js';
import { campaignEnforcementActions } from '../db/schema/support.js';
import { founderGhostBans } from '../db/schema/fulfillment.js';
import {
  founderAccessActions,
  founderDeletionRequests,
  founderDeletionReviews,
} from '../db/schema/founder-workspace.js';
import { formatUsdCents } from '../payments/listing-notifications.js';
import { GHOST_BAN_TRIGGER_LABELS, type GhostBanTrigger } from '../fulfillment/logic.js';

/* ── What the composer is pointed at ───────────────────────────────────────── */

export interface FounderHistoryScope {
  prospectId: string;
  /** Every draft this person has ever had, including archived restarts. */
  draftIds: readonly string[];
  /** Every campaign container behind those drafts. */
  campaignIds: readonly string[];
  /** The account, once one exists. Null before the claim. */
  founderUserId: string | null;
  /** How the feed refers to the person. */
  preferredName: string;
}

interface Draft {
  category: FounderHistoryCategory;
  at: Date;
  title: string;
  body: string;
  reason?: string | null;
  audit?: FounderHistoryEntry['audit'];
  source: string;
}

/* ── Lifecycle titles (§23.1, §3.1) ────────────────────────────────────────── */

/**
 * The category a lifecycle transition belongs to.
 *
 * Most of §23.1 is a campaign fact, but four of its states are about the
 * account, the money, or enforcement — and filing "Founder account created"
 * under Campaigns would make the Account chip empty on exactly the person whose
 * account was just created.
 */
function categoryForStatus(status: string): FounderHistoryCategory {
  switch (status) {
    case 'vetting_submitted':
      return 'invite';
    case 'account_claimed':
      return 'account';
    case 'captured_pending_w9':
    case 'single_payment_released':
    case 'first_payment_released':
    case 'remaining_payment_released':
      return 'money';
    case 'suspended':
    case 'killed':
    case 'banned_founder':
      return 'enforcement';
    default:
      return 'campaign';
  }
}

/**
 * A plain title for the transitions that have an obvious one.
 *
 * Anything unmapped renders "Campaign status changed" with the §3.1 label in
 * the body — complete either way, because the body always names the state in
 * the words a person may read, never the enum value.
 */
const STATUS_TITLES: Record<string, string> = {
  vetting_submitted: 'Founder setup submitted',
  account_claimed: 'Founder account created',
  listing_fee_pending: 'Listing fee due',
  affiliate_response_and_build: 'Creator response period started',
  pending_review: 'Campaign submitted for review',
  changes_required: 'Changes requested',
  approved: 'Campaign approved',
  live: 'Campaign launched',
  closed_pending_capture: 'Campaign closed',
  capture_retry_window: 'Retrying failed cards',
  closed_reconciling: 'Campaign reconciling',
  captured_pending_w9: 'Waiting for the W-9 before payment',
  single_payment_released: 'Founder payment released',
  first_payment_released: 'First Founder payment released',
  remaining_payment_released: 'Remaining Founder payment released',
  day_14_review: 'Day 14 progress review opened',
  fulfilled: 'Delivery recorded',
  closed_resolved: 'Campaign closed and reconciled',
  ended_no_charge: 'Campaign ended with no Backers charged',
  refunded_no_creator: 'Campaign ended — no Creator accepted',
  suspended: 'Campaign suspended',
  killed: 'Campaign stopped by Proovd',
  banned_founder: 'Founder no longer eligible',
};

/* ── The audit actions with no first-class record of their own ─────────────── */

interface AuditEntrySpec {
  category: FounderHistoryCategory;
  title: string;
}

const AUDIT_ACTIONS: Record<string, AuditEntrySpec> = {
  'invitation.prospect_created': { category: 'invite', title: 'Founder prospect created' },
  'invitation.prospect_updated': { category: 'admin', title: 'Discovery record updated' },
  'invitation.composed': { category: 'invite', title: 'Invitation content edited' },
  'invitation.revoked': { category: 'invite', title: 'Invitation canceled' },
  'invitation.send_failed': { category: 'invite', title: 'Invitation could not be delivered' },
  'vetting.prefilled': { category: 'invite', title: 'Setup answers prepared by Proovd' },
  'vetting.submitted': { category: 'invite', title: 'Founder setup submitted' },
  'vetting.possible_creator_result_recorded': {
    category: 'invite',
    title: 'Potential Creator matches recorded',
  },
  'vetting.archived_and_restarted': {
    category: 'campaign',
    title: 'Campaign record archived and setup restarted',
  },
  [FOUNDER_FIELD_UPDATED]: { category: 'admin', title: 'Founder record updated' },
  [FOUNDER_OVERRIDE_SET]: { category: 'admin', title: 'Invitation value overridden' },
  [FOUNDER_OVERRIDE_CLEARED]: { category: 'admin', title: 'Invitation override removed' },
  [FOUNDER_SENDER_RECORDED]: { category: 'invite', title: 'Invitation sender recorded' },
  [FOUNDER_ACCESS_RECORDED]: { category: 'enforcement', title: 'Founder access decision recorded' },
  [FOUNDER_DELETION_REQUESTED]: { category: 'account', title: 'Account closure requested' },
  [FOUNDER_DELETION_REVIEWED]: { category: 'account', title: 'Account closure request reviewed' },
};

/* ── The read ──────────────────────────────────────────────────────────────── */

export async function readFounderHistory(
  db: Database,
  scope: FounderHistoryScope,
): Promise<FounderHistoryEntry[]> {
  const drafts: Draft[] = [];
  const { draftIds, campaignIds, founderUserId, preferredName } = scope;

  /* ── Invitation sends (§7) ─────────────────────────────────────────────── */

  const sends = draftIds.length
    ? await db
        .select({
          draftId: campaignInvitationSends.draftId,
          sentAt: campaignInvitationSends.sentAt,
          recipientEmail: campaignInvitationSends.recipientEmail,
          notificationId: campaignInvitationSends.notificationId,
          tokenVersion: campaignInvitationSends.tokenVersion,
          sentBy: campaignInvitationSends.sentBy,
        })
        .from(campaignInvitationSends)
        .where(inArray(campaignInvitationSends.draftId, [...draftIds]))
        .orderBy(campaignInvitationSends.sentAt)
    : [];

  const sendsSeen = new Map<string, number>();
  for (const send of sends) {
    const seen = sendsSeen.get(send.draftId) ?? 0;
    sendsSeen.set(send.draftId, seen + 1);
    drafts.push({
      category: 'invite',
      at: send.sentAt,
      title: seen === 0 ? 'Invite sent' : 'New invite sent',
      body:
        (seen === 0
          ? `Invitation sent to ${send.recipientEmail ?? 'the recorded address'}.`
          : `A new invitation was sent to ${send.recipientEmail ?? 'the recorded address'}. The previous invitation link stopped working.`) +
        (send.notificationId
          ? ''
          : ' Delivery has not been confirmed by the email provider yet.'),
      source: 'campaign_invitation_sends',
    });
  }

  /* ── The first time the link was actually opened (§28.1, 0037) ─────────── */

  const opens = draftIds.length
    ? await db
        .select({ firstUsedAt: secureTokens.firstUsedAt, version: secureTokens.version })
        .from(secureTokens)
        .where(
          and(
            eq(secureTokens.scope, 'founder_draft'),
            inArray(secureTokens.campaignDraftId, [...draftIds]),
            isNotNull(secureTokens.firstUsedAt),
          ),
        )
    : [];

  for (const open of opens) {
    drafts.push({
      category: 'invite',
      at: open.firstUsedAt!,
      title: 'Invite opened',
      body: `${preferredName} opened their private Founder setup.`,
      source: 'secure_tokens',
    });
  }

  /* ── Lifecycle (§23.1) ─────────────────────────────────────────────────── */

  const transitions = campaignIds.length
    ? await db
        .select({
          toStatus: sql<string>`${campaignStatusHistory.toStatus}::text`,
          actor: campaignStatusHistory.actor,
          occurredAt: campaignStatusHistory.occurredAt,
        })
        .from(campaignStatusHistory)
        .where(inArray(campaignStatusHistory.campaignId, [...campaignIds]))
    : [];

  for (const move of transitions) {
    drafts.push({
      category: categoryForStatus(move.toStatus),
      at: move.occurredAt,
      title: STATUS_TITLES[move.toStatus] ?? 'Campaign status changed',
      body: `The campaign moved to “${campaignStatusLabel(move.toStatus)}.”`,
      source: 'campaign_status_history',
    });
  }

  /* ── Audit events with no first-class record here (§25.6) ──────────────── */

  const auditTargets: SQL[] = [
    and(
      eq(auditEvents.targetType, 'founder_prospect'),
      eq(auditEvents.targetId, scope.prospectId),
    )!,
  ];
  if (draftIds.length) {
    auditTargets.push(
      and(
        inArray(auditEvents.targetType, ['campaign_draft', 'campaign_vetting']),
        inArray(auditEvents.targetId, [...draftIds]),
      )!,
    );
  }
  if (campaignIds.length) {
    auditTargets.push(
      and(eq(auditEvents.targetType, 'campaign'), inArray(auditEvents.targetId, [...campaignIds]))!,
    );
  }

  const audits = await db
    .select()
    .from(auditEvents)
    .where(
      and(or(...auditTargets), inArray(auditEvents.action, Object.keys(AUDIT_ACTIONS))),
    )
    .orderBy(desc(auditEvents.occurredAt));

  for (const row of audits) {
    const spec = AUDIT_ACTIONS[row.action]!;
    const prior = row.priorValue;
    const next = row.newValue;
    const fieldEdit = isFieldEditAuditValue(next) ? next : null;

    drafts.push({
      category: spec.category,
      at: row.occurredAt,
      title: fieldEdit ? `${fieldEdit.label} updated` : spec.title,
      body: bodyForAudit(row.action, spec.title, row.customerExplanation, fieldEdit),
      reason: row.internalReason,
      audit: fieldEdit
        ? {
            by: row.actor,
            field: fieldEdit.label,
            priorValue: isFieldEditAuditValue(prior) ? (prior.value ?? '—') : '—',
            newValue: fieldEdit.value ?? '—',
            reason: row.internalReason,
            evidence: evidenceOf(row.evidenceLinks),
            at: formatInstant(row.occurredAt) ?? row.occurredAt.toISOString(),
          }
        : null,
      source: 'audit_events',
    });
  }

  /* ── §33.12.4 overrides ────────────────────────────────────────────────── */

  const overrideTargets = [scope.prospectId, ...campaignIds, ...draftIds];
  const overrides = await db
    .select()
    .from(adminOverrides)
    .where(inArray(adminOverrides.targetId, overrideTargets));

  for (const row of overrides) {
    drafts.push({
      category: 'admin',
      at: row.occurredAt,
      title: 'Admin override recorded',
      body: row.customerExplanation,
      reason: row.internalReason,
      audit: {
        by: row.actor,
        field: row.fieldKey,
        priorValue: JSON.stringify(row.priorValue),
        newValue: JSON.stringify(row.newValue),
        reason: row.internalReason,
        evidence: evidenceOf(row.evidenceLinks),
        at: formatInstant(row.occurredAt) ?? row.occurredAt.toISOString(),
      },
      source: 'admin_overrides',
    });
  }

  /* ── Money (§24.6, §22.3, §13) ─────────────────────────────────────────── */

  const listings = campaignIds.length
    ? await db
        .select()
        .from(listingFeePayments)
        .where(inArray(listingFeePayments.campaignId, [...campaignIds]))
    : [];

  for (const row of listings) {
    drafts.push({
      category: 'money',
      at: row.paidAt,
      title: 'Listing fee paid',
      body: `${preferredName} paid ${formatUsdCents(row.totalCents)}, including ${formatUsdCents(row.taxCents)} in sales tax.`,
      source: 'listing_fee_payments',
    });
  }

  const w9Events = campaignIds.length
    ? await db
        .select()
        .from(founderW9Events)
        .where(inArray(founderW9Events.campaignId, [...campaignIds]))
    : [];

  for (const row of w9Events) {
    drafts.push({
      category: 'money',
      at: row.occurredAt,
      title: W9_TITLES[row.toStatus] ?? 'W-9 updated',
      body: W9_BODIES[row.toStatus]?.(preferredName) ?? `The W-9 record moved to ${row.toStatus}.`,
      reason: row.reason,
      source: 'founder_w9_events',
    });
  }

  const payments = campaignIds.length
    ? await db
        .select()
        .from(founderPayments)
        .where(inArray(founderPayments.campaignId, [...campaignIds]))
    : [];

  for (const row of payments) {
    drafts.push({
      category: 'money',
      at: row.createdAt,
      title: 'Founder payment became eligible',
      body: `${formatUsdCents(row.amountCents)} was recorded as eligible for release.`,
      source: 'founder_payments',
    });
    if (row.releasedAt) {
      drafts.push({
        category: 'money',
        at: row.releasedAt,
        title: 'Founder payment released',
        body:
          `${formatUsdCents(row.amountCents)} was released to ${preferredName}.` +
          (row.releasedEarly ? ' Released early on recorded evidence (§22.3).' : ''),
        source: 'founder_payments',
      });
    }
  }

  if (founderUserId) {
    const accounts = await db
      .select({ id: stripeConnectedAccounts.id })
      .from(stripeConnectedAccounts)
      .where(eq(stripeConnectedAccounts.ownerUserId, founderUserId));

    if (accounts.length) {
      const accountEvents = await db
        .select()
        .from(stripeAccountEvents)
        .where(
          inArray(
            stripeAccountEvents.connectedAccountId,
            accounts.map((a) => a.id),
          ),
        );

      for (const row of accountEvents) {
        drafts.push({
          category: 'money',
          at: row.occurredAt,
          title: STRIPE_EVENT_TITLES[row.event] ?? 'Payment setup updated',
          body: stripeEventBody(row.event, row.newState, preferredName),
          source: 'stripe_account_events',
        });
      }
    }
  }

  /* ── Support (§26.7) ───────────────────────────────────────────────────── */

  const supportWhere: SQL[] = [];
  if (campaignIds.length) {
    supportWhere.push(inArray(supportCases.campaignId, [...campaignIds]));
  }
  if (founderUserId) supportWhere.push(eq(supportCases.requesterUserId, founderUserId));

  const cases = supportWhere.length
    ? await db.select().from(supportCases).where(or(...supportWhere))
    : [];

  for (const row of cases) {
    drafts.push({
      category: 'support',
      at: row.createdAt,
      title: 'Support case opened',
      body: `Case ${row.reference} — ${row.topic.replace(/_/g, ' ')}. Owned by ${row.owner === 'proovd' ? 'Proovd' : row.owner.replace(/_/g, ' ')}.`,
      source: 'support_cases',
    });
    if (row.resolvedAt) {
      drafts.push({
        category: 'support',
        at: row.resolvedAt,
        title: 'Support case resolved',
        body: `Case ${row.reference} was closed.`,
        source: 'support_cases',
      });
    }
  }

  /* ── Enforcement (§26.7, §29, §22.7) ───────────────────────────────────── */

  const enforcement = campaignIds.length
    ? await db
        .select()
        .from(campaignEnforcementActions)
        .where(inArray(campaignEnforcementActions.campaignId, [...campaignIds]))
    : [];

  for (const row of enforcement) {
    drafts.push({
      category: 'enforcement',
      at: row.occurredAt,
      title: row.action === 'kill' ? 'Campaign stopped by Proovd' : 'Campaign suspended',
      body: row.customerExplanation,
      reason: row.reasonDetail,
      audit: {
        by: row.actor,
        field: 'Campaign status',
        priorValue: campaignStatusLabel(row.priorCampaignStatus),
        newValue: campaignStatusLabel(row.newCampaignStatus),
        reason: row.reasonDetail,
        evidence: evidenceOf(row.evidenceLinks),
        at: formatInstant(row.occurredAt) ?? row.occurredAt.toISOString(),
      },
      source: 'campaign_enforcement_actions',
    });
  }

  const access = await db
    .select()
    .from(founderAccessActions)
    .where(eq(founderAccessActions.prospectId, scope.prospectId))
    .orderBy(founderAccessActions.occurredAt);

  for (const row of access) {
    drafts.push({
      category: 'enforcement',
      at: row.occurredAt,
      title: row.action === 'suspend' ? 'Founder access suspended' : 'Founder access restored',
      body:
        row.action === 'suspend'
          ? `${preferredName}’s Founder access was suspended while Proovd reviews the issue below.`
          : `${preferredName}’s Founder access was restored.`,
      reason: row.reason,
      audit: {
        by: row.actor,
        field: 'Founder access',
        priorValue: row.action === 'suspend' ? 'Active' : 'Access suspended',
        newValue: row.action === 'suspend' ? 'Access suspended' : 'Active',
        reason: row.reason,
        evidence: row.evidence ?? '—',
        at: formatInstant(row.occurredAt) ?? row.occurredAt.toISOString(),
      },
      source: 'founder_access_actions',
    });
  }

  if (founderUserId) {
    const bans = await db
      .select()
      .from(founderGhostBans)
      .where(eq(founderGhostBans.founderUserId, founderUserId));

    for (const row of bans) {
      drafts.push({
        category: 'enforcement',
        at: row.decidedAt,
        title: 'Founder permanently banned',
        body: row.notice,
        reason: row.internalReason,
        audit: {
          by: row.decidedBy,
          field: 'Founder eligibility',
          priorValue: 'Eligible',
          newValue: 'Permanently banned',
          reason:
            GHOST_BAN_TRIGGER_LABELS[row.trigger as GhostBanTrigger] ?? row.internalReason,
          evidence: row.evidence,
          at: formatInstant(row.decidedAt) ?? row.decidedAt.toISOString(),
        },
        source: 'founder_ghost_bans',
      });
    }
  }

  /* ── Account closure (§25.8) ───────────────────────────────────────────── */

  const requests = await db
    .select()
    .from(founderDeletionRequests)
    .where(eq(founderDeletionRequests.prospectId, scope.prospectId));

  for (const row of requests) {
    drafts.push({
      category: 'account',
      at: row.requestedAt,
      title: 'Account closure requested',
      body: `${preferredName} asked Proovd to close their account. Some records may still need to be retained.`,
      reason: row.requestDetail,
      source: 'founder_deletion_requests',
    });
  }

  if (requests.length) {
    const reviews = await db
      .select()
      .from(founderDeletionReviews)
      .where(
        inArray(
          founderDeletionReviews.requestId,
          requests.map((r) => r.id),
        ),
      );

    for (const row of reviews) {
      drafts.push({
        category: 'account',
        at: row.occurredAt,
        title: 'Account closure request reviewed',
        body: row.note,
        source: 'founder_deletion_reviews',
      });
    }
  }

  /* ── One ordering, one actor lookup, one shape ─────────────────────────── */

  const names = await resolveActorNames(db, [
    ...sends.map((s) => s.sentBy),
    ...transitions.map((t) => t.actor),
    ...audits.map((a) => a.actor),
    ...overrides.map((o) => o.actor),
    ...access.map((a) => a.actor),
    ...enforcement.map((e) => e.actor),
  ]);

  drafts.sort((a, b) => b.at.getTime() - a.at.getTime());

  return drafts.map((draft) => ({
    category: draft.category,
    at: formatInstant(draft.at) ?? draft.at.toISOString(),
    occurredAt: draft.at.toISOString(),
    title: draft.title,
    body: draft.body,
    reason: draft.reason ?? null,
    audit: draft.audit
      ? { ...draft.audit, by: actorName(names, draft.audit.by) ?? draft.audit.by }
      : null,
    source: draft.source,
  }));
}

/** Counts per chip, so a zero-count filter can be hidden without a scan. */
export function historyCountsOf(entries: readonly FounderHistoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const entry of entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }
  return counts;
}

/* ── Small renderers ───────────────────────────────────────────────────────── */

const W9_TITLES: Record<string, string> = {
  requested: 'W-9 requested',
  submitted: 'W-9 submitted',
  verified: 'W-9 verified',
};

const W9_BODIES: Record<string, (name: string) => string> = {
  requested: (name) =>
    `${name} was asked to submit a W-9 before any Founder payment could be released.`,
  submitted: (name) => `${name} submitted their W-9.`,
  verified: (name) => `Proovd verified ${name}’s W-9.`,
};

const STRIPE_EVENT_TITLES: Record<string, string> = {
  link_created: 'Payment setup started',
  returned: 'Returned from payment setup',
  refreshed: 'Payment setup link refreshed',
  account_updated: 'Payment setup updated',
  deauthorized: 'Payment setup disconnected',
};

const CONNECTED_STATE_WORDS: Record<string, string> = {
  not_started: 'not started',
  more_information_required: 'more information required',
  under_review: 'under review',
  restricted: 'restricted',
  complete: 'complete',
};

function stripeEventBody(event: string, newState: string | null, name: string): string {
  if (event === 'link_created') return `${name} started Stripe payment setup.`;
  if (event === 'deauthorized') return `Stripe payment setup was disconnected.`;
  const word = newState ? CONNECTED_STATE_WORDS[newState] : null;
  return word
    ? `Stripe reported that ${name}’s payment setup is ${word}.`
    : `Stripe reported an update to ${name}’s payment setup.`;
}

/**
 * The sentence under an audit-only entry.
 *
 * A customer explanation is preferred where the act produced one, because that
 * is the wording the person on the other end actually received (§25.6 keeps it
 * in its own column for that reason). A field edit describes itself.
 */
function bodyForAudit(
  action: string,
  fallback: string,
  customerExplanation: string | null,
  fieldEdit: { label: string; value: string | null } | null,
): string {
  if (fieldEdit) {
    return fieldEdit.value === null
      ? `${fieldEdit.label} was cleared.`
      : `${fieldEdit.label} was changed to “${fieldEdit.value}.”`;
  }
  if (customerExplanation) return customerExplanation;
  if (action === 'invitation.send_failed') {
    return 'The email provider did not accept the message, so nothing was delivered.';
  }
  return `${fallback}.`;
}

/** §25.6's evidence links, rendered as something an Admin can read. */
function evidenceOf(links: unknown): string {
  if (links === null || links === undefined) return '—';
  if (typeof links === 'string') return links || '—';
  if (Array.isArray(links)) return links.length ? links.map(String).join(', ') : '—';
  if (typeof links === 'object') {
    const values = Object.values(links as Record<string, unknown>).map(String).filter(Boolean);
    return values.length ? values.join(', ') : '—';
  }
  return String(links);
}
