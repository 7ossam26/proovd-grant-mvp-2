/**
 * The attribution ingest and resolution — Spec §18, §33.6.1–5 (Phase 14b).
 *
 * ── recordClick: what a valid click is, decided at the click (§33.6.3) ───────
 * §18: "Links used before activated_at, while paused, or after close cannot
 * create payable attribution." Whether a click is attributed is decided from the
 * link's state at the instant it arrives, never from anything the visitor
 * controls, and the reason an ignored click earned nothing is written to the
 * ledger. A mid-campaign Creator's link activates later, so a click before that
 * Creator's own `activated_at` is `before_activation` — the same rule, which is
 * why "mid-campaign prior traffic earns nothing" needs no separate branch.
 *
 * ── resolveAttribution: provisional until verified (§33.6.4) ─────────────────
 * The winner is read from the cookie's linkId, and its status is computed from
 * the link's CURRENT state — because a link can pause after the click. A paused
 * link (a correction or rejection, §17) is `blocked`; a link whose first post
 * has passed is `verified`; anything else is `provisional`. The status is never
 * stored: storing it would freeze an answer the next verification changes.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import type { ClickIgnoredReason, ClickOutcome, AttributionStatus } from './vocabulary.js';

type Executor = Pick<Database, 'select' | 'insert'>;

export interface RecordedClick {
  found: boolean;
  campaignId: string | null;
  associationId: string | null;
  trackingLinkId: string | null;
  outcome: ClickOutcome | null;
  reason: ClickIgnoredReason | null;
  campaignCloseAt: Date | null;
}

const NOT_FOUND: RecordedClick = {
  found: false,
  campaignId: null,
  associationId: null,
  trackingLinkId: null,
  outcome: null,
  reason: null,
  campaignCloseAt: null,
};

/**
 * Records one arrival through `/c/:code` and decides whether it is the attributed
 * winner on this browser. Always inserts a ledger row (§25.6, for audit); the
 * caller sets the winner cookie only when the outcome is `attributed`.
 */
export async function recordClick(
  db: Executor,
  input: { code: string; visitorId: string; linkTest: boolean; now: Date },
): Promise<RecordedClick> {
  const [row] = await db
    .select({
      linkId: trackingLinks.id,
      activatedAt: trackingLinks.activatedAt,
      pausedAt: trackingLinks.pausedAt,
      associationId: trackingLinks.associationId,
      campaignId: campaigns.id,
      status: campaigns.status,
      campaignCloseAt: campaigns.campaignCloseAt,
    })
    .from(trackingLinks)
    .innerJoin(campaigns, eq(campaigns.id, trackingLinks.campaignId))
    .where(eq(trackingLinks.code, input.code))
    .limit(1);

  if (!row) return NOT_FOUND;

  const reason = decideIgnoredReason(row, input);
  const outcome: ClickOutcome = reason === null ? 'attributed' : 'ignored';

  await db.insert(trackingLinkClicks).values({
    campaignId: row.campaignId,
    trackingLinkId: row.linkId,
    associationId: row.associationId,
    visitorId: input.visitorId,
    clickedAt: input.now,
    outcome,
    ignoredReason: reason,
    linkTest: input.linkTest,
  });

  return {
    found: true,
    campaignId: row.campaignId,
    associationId: row.associationId,
    trackingLinkId: row.linkId,
    outcome,
    reason,
    campaignCloseAt: row.campaignCloseAt,
  };
}

/**
 * The single ordered decision for why a click cannot create payable attribution,
 * or null when it can. The order is link-specific first (§18's own list —
 * activation, pause), then campaign-window (close, live), so the recorded reason
 * is the most specific true one.
 */
function decideIgnoredReason(
  link: {
    activatedAt: Date | null;
    pausedAt: Date | null;
    status: string;
    campaignCloseAt: Date | null;
  },
  input: { linkTest: boolean; now: Date },
): ClickIgnoredReason | null {
  // §14.1: the safe link-test marker. Recorded, and excluded from everything.
  if (input.linkTest) return 'link_test';
  // Before activation: the link was never activated, or this click predates its
  // activation (a mid-campaign Creator's traffic before their own activated_at).
  if (!link.activatedAt || input.now.getTime() < link.activatedAt.getTime()) {
    return 'before_activation';
  }
  // Paused by a correction/rejection (§17/§33.4.8).
  if (link.pausedAt) return 'paused';
  // At or after close, the cookie has already expired — no new attribution.
  if (link.campaignCloseAt && input.now.getTime() >= link.campaignCloseAt.getTime()) {
    return 'after_close';
  }
  // Any campaign not in its live window (suspended, killed, or not yet public).
  if (link.status !== 'live') return 'campaign_not_live';
  return null;
}

export interface ResolvedAttribution {
  trackingLinkId: string;
  associationId: string;
  handle: string | null;
  status: AttributionStatus;
}

/**
 * The current attribution a winner cookie resolves to, or null if its link no
 * longer belongs to this campaign (a forged or stale cookie). The status is
 * computed live, so a link paused after the click reads `blocked` even though
 * the click was valid when it happened.
 */
export async function resolveAttribution(
  db: Pick<Database, 'select'>,
  input: { campaignId: string; trackingLinkId: string },
): Promise<ResolvedAttribution | null> {
  const [link] = await db
    .select({
      id: trackingLinks.id,
      active: trackingLinks.active,
      activatedAt: trackingLinks.activatedAt,
      pausedAt: trackingLinks.pausedAt,
      associationId: trackingLinks.associationId,
      handle: affiliateSignupProfiles.publicHandle,
    })
    .from(trackingLinks)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, trackingLinks.associationId),
    )
    .where(
      and(eq(trackingLinks.id, input.trackingLinkId), eq(trackingLinks.campaignId, input.campaignId)),
    )
    .limit(1);

  if (!link) return null;

  const [submission] = await db
    .select({ status: creatorPostSubmissions.status })
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.associationId, link.associationId))
    .orderBy(desc(creatorPostSubmissions.submittedAt))
    .limit(1);

  const status = resolveStatus(link, submission?.status ?? null);

  return {
    trackingLinkId: link.id,
    associationId: link.associationId,
    handle: link.handle ?? null,
    status,
  };
}

function resolveStatus(
  link: { active: boolean; activatedAt: Date | null; pausedAt: Date | null },
  postStatus: string | null,
): AttributionStatus {
  // Paused (correction/rejection) or somehow deactivated: no earning finalizes.
  if (link.pausedAt || !link.active || !link.activatedAt) return 'blocked';
  // The first post passed verification — payable on a later successful capture.
  if (postStatus === 'passed') return 'verified';
  // Activated but not verified yet: provisional (§33.6.4).
  return 'provisional';
}
