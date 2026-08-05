/**
 * The §26.7 post-capture funds hold — Phase 20b.
 *
 * "Restrict unreleased funds where possible." What is possible under the
 * approved direct-charge configuration: the captured money settled to the
 * Founder's own account at capture (§24.1), so the restrictable edges are the
 * ones Proovd itself operates — the §22.3 Founder-payment create/release
 * decisions and the one §22.1 Affiliate Transfer. Each of those refuses
 * `enforcement_hold` by name while the campaign stands suspended, killed, or
 * banned. Money that already moved is never rewritten (§29.7); recovering it
 * is a §24.8 cause classification, not a hold.
 *
 * The hold is DERIVED from the campaign's own lifecycle — no flag to forget to
 * clear. A suspension reinstated (§23.1) releases the hold by the same read.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignEnforcementActions } from '../db/schema/support.js';

const HELD_STATUSES: readonly string[] = ['suspended', 'killed', 'banned_founder'];

export interface EnforcementHold {
  restricted: boolean;
  /** The lifecycle state that holds it, when held. */
  campaignStatus: string | null;
  /** The latest recorded enforcement action behind the state, where one exists. */
  action: 'suspend' | 'kill' | null;
  occurredAt: Date | null;
}

type Executor = Pick<Database, 'select'>;

export async function campaignEnforcementHold(
  db: Executor,
  campaignId: string,
): Promise<EnforcementHold> {
  const [campaign] = await db
    .select({ status: sql<string>`${campaigns.status}::text` })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign || !HELD_STATUSES.includes(campaign.status)) {
    return { restricted: false, campaignStatus: campaign?.status ?? null, action: null, occurredAt: null };
  }

  const [action] = await db
    .select({
      action: campaignEnforcementActions.action,
      occurredAt: campaignEnforcementActions.occurredAt,
    })
    .from(campaignEnforcementActions)
    .where(eq(campaignEnforcementActions.campaignId, campaignId))
    .orderBy(desc(campaignEnforcementActions.occurredAt))
    .limit(1);

  return {
    restricted: true,
    campaignStatus: campaign.status,
    action: action?.action ?? null,
    occurredAt: action?.occurredAt ?? null,
  };
}
