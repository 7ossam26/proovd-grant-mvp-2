/**
 * Threshold crossing messages — Spec §20, §27.2, §27.3, §27.6, §33.6.10.
 *
 * ── The dedup entity is the CROSSING, not the campaign ──────────────────────
 * §20: "Each crossing is its own event and notification, deduplicated by state
 * transition… a campaign may cross repeatedly, and each crossing notifies once."
 *
 * `notification_deliveries` is unique on (event, target, entity), so keying on the
 * campaign would send the first `reached` and silently swallow every later one —
 * §27.2 satisfied and §20 broken. That is §7's invitation-resend failure in a
 * different phase, and the answer is the same: key on the thing that happens
 * once. A crossing happens once, so `campaign_threshold_crossings.id` is the
 * entity, and a retried send after a provider refusal is still one email because
 * the crossing id has not changed.
 *
 * ── Same posture as every other sender since Phase 11 ───────────────────────
 * The domain event already committed. A provider refusal is recorded and
 * returned, never thrown — the crossing happened whether or not the email left
 * the building, and rolling it back would make the campaign cross twice.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import type { CampaignThresholdCrossing } from '../db/schema/live.js';
import { campaignThresholdCrossings } from '../db/schema/live.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_IDEA_THRESHOLD_REACHED,
  FOUNDER_IDEA_THRESHOLD_LOST,
  INTERNAL_THRESHOLD_REACHED,
  INTERNAL_THRESHOLD_LOST,
} from '../notifications/events.js';
import {
  renderThresholdReached,
  renderThresholdLost,
} from '../notifications/templates/launch.js';
import { renderInternalNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

function utcMinute(instant: Date | null): string {
  return instant ? instant.toISOString().replace('T', ' ').slice(0, 16) : 'the scheduled close';
}

export interface CrossingNotificationResult {
  founder: string;
  internal: string;
}

export async function notifyThresholdCrossing(
  db: Database,
  notifier: Notifier,
  context: LaunchNotificationContext,
  crossing: CampaignThresholdCrossing,
): Promise<CrossingNotificationResult> {
  const founder = await loadFounder(db, crossing.campaignId);

  const [campaign] = await db
    .select({ campaignCloseAt: campaigns.campaignCloseAt })
    .from(campaigns)
    .where(eq(campaigns.id, crossing.campaignId))
    .limit(1);

  const reached = crossing.direction === 'reached';
  const closeUtc = utcMinute(campaign?.campaignCloseAt ?? null);

  let founderOutcome = 'skipped: no Founder address';
  let founderNotificationId: string | null = null;
  if (founder.email) {
    const variables = {
      founderName: founder.name,
      productName: founder.productName,
      campaignUrl: `${context.appBaseUrl}/campaigns/${crossing.campaignId}/home`,
      uniqueActiveBackers: crossing.uniqueActiveBackers,
      threshold: crossing.threshold,
      closeUtc,
      reference: crossing.id,
      supportEmail: context.supportEmail,
    };
    const rendered = reached
      ? await renderThresholdReached(variables)
      : await renderThresholdLost(variables);

    const outcome = await notifier.send({
      eventKey: reached ? FOUNDER_IDEA_THRESHOLD_REACHED : FOUNDER_IDEA_THRESHOLD_LOST,
      // The crossing, not the campaign — see the header.
      entityType: 'campaign_threshold_crossing',
      entityId: crossing.id,
      to: founder.email,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      ...rendered,
    });
    founderOutcome = outcome.status;
    if (outcome.status === 'sent') founderNotificationId = outcome.notificationId;
  }

  /* §27.6's internal counterpart, to the staffed inbox. */
  const internalNotice = await renderInternalNotice({
    subject: `Threshold ${crossing.direction} — campaign ${crossing.campaignId}`,
    headline: `Order threshold ${crossing.direction} — campaign ${crossing.campaignId}`,
    facts: [
      { label: 'Unique active Backers', value: String(crossing.uniqueActiveBackers) },
      { label: 'Order threshold', value: String(crossing.threshold) },
      { label: 'Measured again at close', value: `${closeUtc} UTC` },
    ],
    paragraphs: [
      'A campaign may cross repeatedly; each crossing is its own recorded event and notifies once. Nothing about the charge decision changes until close, when the threshold is decided from the state at exactly that instant.',
    ],
    action: { label: 'Open campaign operations', url: `${context.appBaseUrl}/admin/campaign-operations` },
    reference: crossing.campaignId,
    supportEmail: context.supportEmail,
  });

  const internal = await notifier.send({
    eventKey: reached ? INTERNAL_THRESHOLD_REACHED : INTERNAL_THRESHOLD_LOST,
    entityType: 'campaign_threshold_crossing',
    entityId: crossing.id,
    to: context.supportEmail,
    from: context.fromAddress,
    ...internalNotice,
  });

  // §7's "recorded, not confirmed delivered" state, made visible: the crossing
  // carries the delivery ids once the provider confirmed them, and NULL is an
  // honest state rather than a failure nobody can see.
  await db
    .update(campaignThresholdCrossings)
    .set({
      founderNotificationId,
      internalNotificationId: internal.status === 'sent' ? internal.notificationId : null,
    })
    .where(eq(campaignThresholdCrossings.id, crossing.id));

  return { founder: founderOutcome, internal: internal.status };
}
