/**
 * The pre-charge reminder sweep — Spec §20, §27.5, Appendix B.3.
 *
 * Approximately 24 hours before the charge decision, one reminder per still-
 * active scheduled transaction. A reservation created less than 24 hours before
 * the trigger is picked up on the next sweep and sent promptly; the later
 * duplicate is suppressed because the notification dedups on the reservation and
 * `reminder_sent_at` is claimed before the send.
 *
 * ── Only eligible reservations receive one ──────────────────────────────────
 * §20: "Canceled, killed, dropped, already captured, or otherwise ineligible
 * reservations receive none." The selection is `reserved_active` on a `live`
 * campaign only — every ineligible state is some other status, so it is excluded
 * by the WHERE, not by a special case. For Idea, the condition line never implies
 * the threshold is final before close (B.3).
 *
 * Safe to run twice: the `reminder_sent_at` claim is a conditional UPDATE and the
 * email dedups on the reservation.
 */

import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations, campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import { sendPrechargeReminder } from '../notifications/backer.js';
import { mintOrReissueMagicLink } from './magic-link.js';
import { formatCents } from './restated.js';
import { formatUtcInstant } from './consent.js';

/** §20: "approximately 24 hours before the trigger." Stated by the Spec, not §6. */
export const PRECHARGE_REMINDER_LEAD_HOURS = 24;

export interface ReminderDeps {
  db: Database;
  notifier: Notifier;
  tokenService: TokenService;
  fromAddress: string;
  appBaseUrl: string;
}

export interface ReminderSweepResult {
  sent: number;
  claimed: number;
}

export async function sweepPrechargeReminders(
  deps: ReminderDeps,
  opts: { now?: Date } = {},
): Promise<ReminderSweepResult> {
  const now = opts.now ?? new Date();
  const windowEnd = new Date(now.getTime() + PRECHARGE_REMINDER_LEAD_HOURS * 60 * 60 * 1000);

  // Every eligible, not-yet-reminded transaction whose charge decision is within
  // the window. `reserved_active` on a `live` campaign excludes every ineligible
  // state by construction (§20).
  const due = await deps.db
    .select({
      reservationId: reservations.id,
      campaignId: reservations.campaignId,
      backerIdentityId: reservations.backerIdentityId,
      backerEmail: reservations.backerEmail,
      rewardSubtotalCents: reservations.rewardSubtotalCents,
      salesTaxCents: reservations.salesTaxCents,
      totalAuthorizedCents: reservations.totalAuthorizedCents,
      statementDescriptor: reservations.statementDescriptor,
      closeAt: campaigns.campaignCloseAt,
      model: campaigns.type,
      title: campaignBuild.title,
      founderDisplayName: campaignBuild.founderDisplayName,
      orderThreshold: campaignBuild.orderThreshold,
      claimLegalName: founderClaimProfiles.legalName,
    })
    .from(reservations)
    .innerJoin(campaigns, eq(campaigns.id, reservations.campaignId))
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, reservations.campaignId))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, reservations.campaignId))
    .where(
      and(
        eq(reservations.status, 'reserved_active'),
        eq(campaigns.status, 'live'),
        isNull(reservations.reminderSentAt),
        gt(campaigns.campaignCloseAt, now),
        lte(campaigns.campaignCloseAt, windowEnd),
      ),
    );

  let claimed = 0;
  let sent = 0;
  // One reissued link per Backer, so a Backer with several transactions does not
  // get several rotations in one sweep (the last would kill the earlier links).
  const linkByBacker = new Map<string, string>();

  for (const row of due) {
    // Claim the reminder before sending, so a concurrent sweep sends nothing.
    const claimedRow = await deps.db
      .update(reservations)
      .set({ reminderSentAt: now })
      .where(and(eq(reservations.id, row.reservationId), isNull(reservations.reminderSentAt)))
      .returning({ id: reservations.id });
    if (claimedRow.length !== 1) continue;
    claimed += 1;

    if (!row.backerEmail || !row.closeAt) continue;

    let magicLinkUrl = linkByBacker.get(row.backerIdentityId);
    if (!magicLinkUrl) {
      const link = await mintOrReissueMagicLink(
        { db: deps.db, tokenService: deps.tokenService, appBaseUrl: deps.appBaseUrl },
        { campaignId: row.campaignId, backerIdentityId: row.backerIdentityId },
      );
      magicLinkUrl = link.url;
      linkByBacker.set(row.backerIdentityId, magicLinkUrl);
    }

    const condition =
      row.model === 'pre_build'
        ? `The card is charged only if the campaign reaches its order threshold of ${
            row.orderThreshold ?? 0
          } unique Backers at close. A met threshold does not guarantee every card succeeds.`
        : 'The card is charged on the close date. A charge decision does not guarantee the card succeeds.';

    const outcome = await sendPrechargeReminder(
      { notifier: deps.notifier, from: deps.fromAddress },
      {
        to: row.backerEmail,
        reservationId: row.reservationId,
        campaignTitle: row.title ?? 'your campaign',
        founderLegalName: row.founderDisplayName ?? row.claimLegalName ?? 'the Founder',
        rewardSubtotal: formatCents(row.rewardSubtotalCents),
        salesTax: formatCents(row.salesTaxCents),
        totalAuthorized: formatCents(row.totalAuthorizedCents ?? 0n),
        whenUtc: formatUtcInstant(row.closeAt),
        condition,
        statementDescriptor: row.statementDescriptor ?? 'PROOVD',
        magicLinkUrl,
      },
    ).then(() => true).catch(() => false);
    if (outcome) sent += 1;
  }

  return { sent, claimed };
}
