/**
 * §27.3's roster update — Spec §27.3, §14.5, §30, §33.6.11 (Phase 22b).
 *
 * ── Why this reads history instead of being called at eighteen call sites ───
 * `transitionAssociation` has eighteen callers across ten modules, and every
 * future one would have to remember to announce. More importantly, the fact
 * being announced is already recorded: `association_status_history` is
 * append-only and holds exactly what changed, when, and at whose hand. Reading
 * it is reading the consequence, which is what §27.3 asks a message to carry.
 *
 * The dedup entity is therefore the history ROW. That is not a convenience —
 * §27.7's digest drops a roster item whose covering key already delivered, and
 * the exclusion binds on `(founder_roster_update, target, history row id)`.
 * Keying on the association would announce the first change and silently
 * swallow every later one (§7's resend failure), and would break the exclusion
 * at the same time.
 *
 * ── This is not a scheduled check-in (§33.6.11) ─────────────────────────────
 * The sweep produces a message only where a real transition is recorded, and
 * only where that transition changes the word on the Founder's roster card
 * (`rosterUpdateFor`). A quiet week sends nothing; there is no branch that
 * turns a date into an email, and no message is composed before the facts are
 * in hand. Its cadence is an operational schedule, not a promise: no message
 * names a delivery time and nothing computes a deadline from it.
 *
 * ── The lookback is a floor on work, not a window on eligibility ────────────
 * `notification_deliveries` is what makes a repeat impossible, so the lookback
 * exists only to keep the query from scanning all history forever. A row older
 * than the lookback is not "expired" — it simply had its chance, and the
 * deployment that was down for a week owes a Founder a stale status change far
 * less than it owes them not to be surprised by one. Stated here so the number
 * is never mistaken for a §6 setting (§1 rule 6).
 */

import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { associationStatusHistory, campaignAffiliateAssociations, campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import type { Notifier } from '../notifications/send.js';
import { FOUNDER_ROSTER_UPDATE } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { rosterUpdateFor } from './roster-labels.js';

type CampaignStatusValue = (typeof campaigns.status)['_']['data'];

export interface RosterNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/** How far back the sweep looks for unannounced transitions. See the header. */
export const ROSTER_UPDATE_LOOKBACK_HOURS = 72;

/**
 * The campaign statuses whose roster a Founder is reading. Before listing
 * payment the roster is Admin's recruitment work in progress and §14.1 has not
 * opened anything; after `ended_no_charge`/`refunded_no_creator` there is no
 * roster to act on. Both ends are the §1.4 rule: a message about a list nobody
 * is looking at is a notification with no consequence behind it.
 */
const ROSTER_LIVE_CAMPAIGN_STATUSES = [
  'affiliate_response_and_build',
  'pending_review',
  'changes_required',
  'approved',
  'creator_prep',
  'creator_replacement',
  'live',
] as const satisfies readonly CampaignStatusValue[];

export interface RosterUpdateOutcome {
  historyId: string;
  status: 'sent' | 'duplicate' | 'silent' | 'no_recipient';
  /** Why nothing was sent, in the words `rosterUpdateFor` used. */
  reason?: string;
}

/**
 * Announces one recorded transition, or explains why it is silent.
 *
 * Safe to call with any history row: the decision is re-derived from the row's
 * own `from`/`to`, so a caller cannot ask for a message §14.5 does not support.
 */
export async function announceRosterUpdate(
  deps: RosterNotifyDeps,
  input: { historyId: string; associationId: string; from: string; to: string; campaignId: string },
): Promise<RosterUpdateOutcome> {
  const decision = rosterUpdateFor(input.from, input.to);
  if (!decision.announce) {
    return {
      historyId: input.historyId,
      status: 'silent',
      reason: decision.reason === 'covered_by' ? `covered_by:${decision.coveredBy}` : decision.reason,
    };
  }

  if (!deps.notifier || !deps.context) {
    return { historyId: input.historyId, status: 'no_recipient', reason: 'no_notifier' };
  }

  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) {
    return { historyId: input.historyId, status: 'no_recipient', reason: 'no_founder_email' };
  }

  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.campaignId))
    .limit(1);
  const title = build?.title ?? founder.productName ?? 'your campaign';

  const notice = await renderPlainNotice({
    // §27.2: a specific subject naming the campaign.
    subject: `A Creator's status changed on ${title}`,
    headline: `${decision.priorLabel} → ${decision.newLabel}`,
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Was', value: decision.priorLabel },
      { label: 'Now', value: decision.newLabel },
      {
        label: 'What you need to do',
        value: 'Nothing right now. Your roster shows who is where.',
      },
    ],
    paragraphs: [
      // §11 keeps the Creator's identity out of the Founder's reach beyond the
      // public handle, and an email is not the surface that changes that — the
      // roster is, and it is one action away.
      'One Creator on this campaign moved to a new status. Your roster names who.',
    ],
    // §27.2: at most one primary action.
    action: {
      label: 'Open your roster',
      url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/roster`,
    },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: FOUNDER_ROSTER_UPDATE,
    entityType: 'association_status_history',
    // The history ROW. §27.7's digest exclusion binds on exactly this.
    entityId: input.historyId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });

  return {
    historyId: input.historyId,
    status: outcome.status === 'sent' ? 'sent' : 'duplicate',
    ...(outcome.status === 'failed' ? { reason: outcome.reason } : {}),
  };
}

export interface RosterSweepResult {
  considered: number;
  sent: number;
  silent: number;
  duplicates: number;
}

/**
 * Every recorded transition inside the lookback, announced or explained.
 *
 * Idempotent by `notification_deliveries`: a second run over the same rows
 * sends nothing. Running it twice, overlapping it, or restarting mid-run are
 * all safe, which is the §28.3 property every job here has.
 */
export async function sweepRosterUpdates(
  deps: RosterNotifyDeps,
  now: Date = new Date(),
): Promise<RosterSweepResult> {
  const since = new Date(now.getTime() - ROSTER_UPDATE_LOOKBACK_HOURS * 3_600_000);

  const rows = await deps.db
    .select({
      historyId: associationStatusHistory.id,
      associationId: associationStatusHistory.associationId,
      from: associationStatusHistory.fromStatus,
      to: associationStatusHistory.toStatus,
      campaignId: campaignAffiliateAssociations.campaignId,
    })
    .from(associationStatusHistory)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, associationStatusHistory.associationId),
    )
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .where(
      and(
        gte(associationStatusHistory.occurredAt, since),
        isNotNull(associationStatusHistory.fromStatus),
        inArray(campaigns.status, [...ROSTER_LIVE_CAMPAIGN_STATUSES]),
      ),
    )
    .orderBy(desc(associationStatusHistory.occurredAt));

  const result: RosterSweepResult = { considered: rows.length, sent: 0, silent: 0, duplicates: 0 };

  for (const row of rows) {
    const outcome = await announceRosterUpdate(deps, {
      historyId: row.historyId,
      associationId: row.associationId,
      from: row.from ?? '',
      to: row.to,
      campaignId: row.campaignId,
    });
    if (outcome.status === 'sent') result.sent += 1;
    else if (outcome.status === 'duplicate') result.duplicates += 1;
    else result.silent += 1;
  }

  return result;
}
