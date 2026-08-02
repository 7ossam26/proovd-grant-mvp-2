/**
 * Discovery timing — Spec §18, §33.6.5 (Phase 14b).
 *
 * §18: "Campaign Days 1–7: public route is accessible through known Creator,
 * Founder, Proovd-house, or direct links but excluded from Proovd
 * browse/discovery and indexing. Beginning Day 8: the campaign may enter Proovd
 * browse/indexable discovery. The Founder receives one factual notice."
 *
 * The switch is `campaigns.discovery_opened_at`, stamped seven days after
 * `campaign_live_at`. Until then the public page renders `noindex` and no browse
 * surface lists it; the page itself stays reachable through any known link the
 * whole time, because the page endpoint never gates on discovery.
 *
 * ── The switch rewrites nothing (§33.6.5) ───────────────────────────────────
 * Opening discovery sets one timestamp and sends one email. It touches no
 * tracking link, no click, and no attribution — the sweep's only write to a
 * campaign is `discovery_opened_at`, conditional on its being NULL, so a second
 * run flips nothing and the immutability trigger refuses to move it regardless.
 *
 * ── Safe to run twice ───────────────────────────────────────────────────────
 * The conditional UPDATE claims the open exactly once; the notice dedups on the
 * campaign through `notification_deliveries`. An overlapping sweep, a crash, or
 * a manual re-run all converge on one open and one notice — the §28.3 property
 * every job here has.
 */

import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { FOUNDER_CAMPAIGN_DISCOVERY_OPENED } from '../notifications/events.js';
import { renderCampaignDiscoveryOpened } from '../notifications/templates/launch.js';
import { DISCOVERY_KNOWN_LINK_ONLY_DAYS } from '../attribution/vocabulary.js';

export interface DiscoveryDeps {
  audit: AuditWriter;
  /** The §18 notice needs a transport; without it the switch still opens silently. */
  notifier?: Notifier;
  context?: LaunchNotificationContext;
}

/**
 * Opens Day 8 discovery for every live campaign whose seventh day has passed and
 * that has not opened yet, sending each Founder the one §18 notice.
 */
export async function sweepDiscovery(
  db: Database,
  deps: DiscoveryDeps,
  now: Date = new Date(),
): Promise<{ opened: string[] }> {
  const cutoff = new Date(now.getTime() - DISCOVERY_KNOWN_LINK_ONLY_DAYS * 24 * 60 * 60 * 1000);

  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'live'),
        lte(campaigns.campaignLiveAt, cutoff),
        isNull(campaigns.discoveryOpenedAt),
      ),
    );

  const opened: string[] = [];
  for (const row of due) {
    if (await openDiscovery(db, deps, row.id, now)) opened.push(row.id);
  }
  return { opened };
}

/**
 * Opens discovery for one campaign. The conditional UPDATE is the pivot: it
 * matches on `discovery_opened_at IS NULL`, so a concurrent or repeated call
 * finds nothing to update and does not send a second notice.
 */
export async function openDiscovery(
  db: Database,
  deps: DiscoveryDeps,
  campaignId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const claimed = await db
    .update(campaigns)
    .set({ discoveryOpenedAt: now, updatedAt: now })
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.discoveryOpenedAt)))
    .returning({ id: campaigns.id });

  if (claimed.length !== 1) return false;

  await deps.audit({
    action: 'campaign.discovery_opened',
    targetType: 'campaign',
    targetId: campaignId,
    internalReason:
      '§18 Day 8: campaign entered browse/indexable discovery seven days after campaign_live_at. ' +
      'No attribution rewritten; one factual Founder notice sent.',
    newValue: { discoveryOpenedAt: now.toISOString() },
    actorId: null,
  });

  if (deps.notifier && deps.context) {
    await notifyDiscoveryOpened(db, deps.notifier, deps.context, campaignId);
  }

  return true;
}

async function notifyDiscoveryOpened(
  db: Database,
  notifier: Notifier,
  context: LaunchNotificationContext,
  campaignId: string,
): Promise<void> {
  const founder = await loadFounder(db, campaignId);
  if (!founder.email) return;

  const rendered = await renderCampaignDiscoveryOpened({
    founderName: founder.name,
    productName: founder.productName,
    campaignUrl: `${context.appBaseUrl}/campaigns/${campaignId}/workspace`,
    reference: campaignId,
    supportEmail: context.supportEmail,
  });

  await notifier.send({
    eventKey: FOUNDER_CAMPAIGN_DISCOVERY_OPENED,
    entityType: 'campaign',
    entityId: campaignId,
    to: founder.email,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
}
