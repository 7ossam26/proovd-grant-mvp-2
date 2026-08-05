/**
 * The Phase 21a senders — Spec §22.4, §22.5, §27.2, §27.3, §27.5, §27.6.
 *
 * `backer_delivery` dedups per RESERVATION: a Backer holding two pre-orders on
 * one campaign is told about each, and a re-run of `recordDelivery` — or a
 * second Admin pressing the same button — tells nobody twice (§27.2). The body
 * is the resolved §22.5 item list, so a message missing the access
 * instructions cannot be produced: the resolver throws first (§33.10.1).
 *
 * `founder_day_14_review_result` dedups per REVIEW row, and
 * `internal_day_14_due` per campaign.
 *
 * A do-not-fulfill share receives no delivery notice. A canceled, killed, or
 * fully-refunded pre-order is not owed access, and telling that Backer their
 * reward is ready would be the product contradicting its own refund.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import type { Day14Review } from '../db/schema/fulfillment.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { loadFounder } from '../launch/notifications.js';
import {
  BACKER_DELIVERY,
  FOUNDER_DAY_14_REVIEW_RESULT,
  INTERNAL_DAY_14_DUE,
} from '../notifications/events.js';
import { renderDeliveryNotice, renderDay14Result } from '../notifications/templates/fulfillment.js';
import { renderInternalNotice } from '../notifications/templates/plain.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import {
  DAY_14_FAILURE_LABELS,
  day14FailureConsequences,
  resolveDeliveryNotice,
  type CampaignType,
  type Day14FailureReason,
  type DeliveryMechanism,
} from './logic.js';

export interface FulfillmentNotificationDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

/** Reservation statuses whose Backer is owed access. */
const DELIVERABLE = ['captured'] as const;

/**
 * §22.5's Backer delivery notice, one per still-fulfillable reservation.
 * Returns how many were sent — the caller records it, and a zero on a campaign
 * with charges is visible rather than silent.
 */
export async function notifyDelivery(
  deps: FulfillmentNotificationDeps,
  input: {
    campaignId: string;
    mechanism: DeliveryMechanism;
    accessInstructions: string;
    originalCommitment: string;
    now: Date;
  },
): Promise<number> {
  if (!deps.notifier || !deps.context) return 0;

  const [build] = await deps.db
    .select({
      title: campaignBuild.title,
      founderDisplay: campaignBuild.founderDisplayName,
      communityUrl: campaignBuild.communityUrl,
    })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.campaignId))
    .limit(1);

  const founder = await loadFounder(deps.db, input.campaignId);
  const campaignTitle = build?.title ?? 'your campaign';

  // §22.5's "Founder support" is the Founder's own route — the community URL
  // they published, or their name where none exists. It is deliberately not
  // Proovd's address: §29.10 routes a Backer to the Founder FIRST, and
  // substituting Proovd's would quietly move the obligation.
  const founderSupport = build?.communityUrl
    ? `${build.founderDisplay ?? founder.name ?? 'The Founder'} — ${build.communityUrl}`
    : `${build?.founderDisplay ?? founder.name ?? 'The Founder'}, through the campaign page`;

  const rows = await deps.db
    .select({
      reservationId: reservations.id,
      backerEmail: reservations.backerEmail,
      backerIdentityId: reservations.backerIdentityId,
      rewardTitle: reservations.rewardTitle,
      fulfillmentState: founderOperationalShares.fulfillmentState,
    })
    .from(reservations)
    .leftJoin(founderOperationalShares, eq(founderOperationalShares.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.campaignId, input.campaignId),
        inArray(reservations.status, [...DELIVERABLE] as never[]),
      ),
    );

  let sent = 0;
  for (const row of rows) {
    if (!row.backerEmail) continue;
    if (row.fulfillmentState === 'do_not_fulfill') continue;

    const notice = resolveDeliveryNotice({
      reward: row.rewardTitle ?? 'your pre-order',
      mechanism: input.mechanism,
      accessInstructions: input.accessInstructions,
      originalCommitment: input.originalCommitment,
      founderSupport,
      proovdEscalation: `Proovd support — ${deps.context.supportEmail}`,
    });

    let actionUrl = `mailto:${deps.context.supportEmail}`;
    if (deps.tokens && row.backerIdentityId) {
      try {
        const link = await mintOrReissueMagicLink(
          { db: deps.db, tokenService: deps.tokens, appBaseUrl: deps.context.appBaseUrl },
          { campaignId: input.campaignId, backerIdentityId: row.backerIdentityId },
        );
        actionUrl = link.url;
      } catch {
        /* the support fallback above stands */
      }
    }

    const rendered = await renderDeliveryNotice({
      campaignTitle,
      rewardTitle: row.rewardTitle ?? 'your pre-order',
      items: notice.items,
      // §27.2: the reservation is the Backer's own stable reference.
      reference: row.reservationId,
      actionUrl,
      supportEmail: deps.context.supportEmail,
    });

    const outcome = await deps.notifier.send({
      eventKey: BACKER_DELIVERY,
      entityType: 'reservation',
      // Once per reservation (§27.2) — a re-run notifies nobody twice.
      entityId: row.reservationId,
      to: row.backerEmail,
      from: deps.context.fromAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (outcome.status === 'sent') sent += 1;
  }

  return sent;
}

/** §27.3's Day 14 result, deduped per review row. */
export async function notifyDay14Result(
  deps: FulfillmentNotificationDeps,
  input: { review: Day14Review; campaignType: CampaignType },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  if (input.review.outcome !== 'pass' && input.review.outcome !== 'fail') return;

  const founder = await loadFounder(deps.db, input.review.campaignId);
  if (!founder.email) return;

  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.review.campaignId))
    .limit(1);

  const reasons = (input.review.failureReasons as Day14FailureReason[]).map(
    (r) => DAY_14_FAILURE_LABELS[r] ?? r,
  );
  const consequences =
    input.review.outcome === 'fail'
      ? day14FailureConsequences(input.campaignType).map((c) => c.label)
      : [];

  const rendered = await renderDay14Result({
    campaignTitle: build?.title ?? 'your campaign',
    outcome: input.review.outcome,
    reasons,
    consequences,
    explanation: input.review.customerExplanation ?? '',
    actionUrl: `${deps.context.appBaseUrl}/campaigns/${input.review.campaignId}/results`,
    reference: input.review.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_DAY_14_REVIEW_RESULT,
    entityType: 'day_14_review',
    entityId: input.review.id,
    to: founder.email,
    from: deps.context.fromAddress,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

/** §27.6's internal notice, once per campaign when the Day 14 anchor arrives. */
export async function notifyDay14Due(
  deps: FulfillmentNotificationDeps,
  input: { campaignId: string; dueAt: Date; internalRecipient: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;

  const [campaign] = await deps.db
    .select({ title: campaignBuild.title, type: sql<string | null>`${campaigns.type}::text` })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  const title = campaign?.title ?? input.campaignId;
  const notice = await renderInternalNotice({
    subject: `Day 14 Progress Check due — ${title}`,
    headline: `Day 14 Progress Check is due — ${title}`,
    facts: [
      // §27.1: a deadline names its zone. `toISOString` ends in `Z`, which is
      // canonical UTC and spells nothing out.
      { label: 'Due', value: `${input.dueAt.toISOString().replace('Z', '')} UTC` },
      {
        label: 'Consequence of failure',
        value:
          campaign?.type === 'pre_build'
            ? 'Idea Campaign — enforcement only; there is no unreleased payment to block'
            : 'Product Campaign — blocks the unreleased remaining payment',
      },
    ],
    action: {
      label: 'Open the Day 14 queue',
      url: `${deps.context.appBaseUrl}/admin/fulfillment`,
    },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_DAY_14_DUE,
    entityType: 'campaign',
    entityId: input.campaignId,
    to: input.internalRecipient,
    from: deps.context.fromAddress,
    ...notice,
  });
}
