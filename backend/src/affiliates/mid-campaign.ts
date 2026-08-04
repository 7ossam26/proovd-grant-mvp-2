/**
 * Mid-campaign Creator addition — Spec §20, §2.2, §33.6.13 (Phase 17b).
 *
 * §20: "Admin may recruit a new Affiliate after launch and before close."
 *
 * ── Almost nothing here is new, and that is the point ───────────────────────
 * The private invitation, the compact signup, the compensation matrix, the
 * readiness checklist, and the tracking link all already exist and are reused
 * unchanged — §20 says "same private campaign-specific invitation and compact
 * account flow", and building a second path would be building a second set of
 * rules to keep in step. `createAffiliateProspect` already takes
 * `rosterIntent: 'mid_campaign'` (§23.4, since Phase 03). What this module adds
 * is the three things §20 asks for that are specific to joining late:
 *
 *   1. the exact remaining time and an adjusted deliverable, recorded as they
 *      were shown, because a Creator who joined with nine days left accepted a
 *      nine-day deliverable and recomputing it later would rewrite that;
 *   2. the campaign's **locked** high-effort result, copied rather than re-read;
 *   3. a **new** `activated_at`, which is what makes "no retroactive
 *      attribution" true.
 *
 * ── No retroactive attribution needs no new code, and that is worth saying ──
 * §33.6.13 and §33.6.3 both require that a mid-campaign Creator earns nothing on
 * prior traffic. The 14b click ingest decides every click against the link's own
 * `activated_at` and records anything earlier as `ignored/before_activation`. So
 * the guarantee is already structural: a link activated today cannot win a click
 * from last week, because the reason it earned nothing is written into the
 * ledger row. This module's job is only to make sure the new link's
 * `activated_at` is *now* rather than the campaign's launch instant — which is
 * exactly what the Phase 14a launch does for the initial roster, and would be
 * wrong here.
 *
 * ── What the addition must not touch ────────────────────────────────────────
 * §20: "Do not change public terms or existing Creators' locked terms" and "Do
 * not reopen campaign review unless the addition requires a material public
 * change." So nothing here writes to `campaign_build`, to another association's
 * agreement, or to `campaigns.status`. The absence of those writes is the
 * enforcement, and the suite asserts it.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { midCampaignAdditions, type MidCampaignAddition } from '../db/schema/live-editing.js';
import type { AuditWriter } from '../auth/audit.js';
import { transitionAssociation, readSlotUsage } from './recruitment.js';
import { ACTIVE_PARTNERSHIP_SLOT_LIMIT } from './registry.js';

/** §20: "Ended campaigns reject addition." Only a live campaign may be joined. */
const JOINABLE_STATUSES = ['live'] as const;

/**
 * §20: "A failed/refunded no-acceptance campaign cannot be revived by a late
 * Affiliate." Named separately from the general refusal because the answer is
 * different — this one is permanent and the Founder was already refunded.
 */
const UNREVIVABLE_STATUSES = ['refunded_no_creator'] as const;

export interface MidCampaignTerms {
  campaignId: string;
  campaignCloseAt: string;
  /** §20: "exact remaining time". Hours, so a surface can render either unit. */
  remainingHours: number;
  /** §20: "the campaign's locked high-effort result". */
  highEffort: boolean | null;
  /** §20: "adjusted reasonable deliverables". */
  adjustedDeliverables: string;
}

export type MidCampaignRefusal =
  | 'campaign_not_found'
  | 'not_live'
  | 'cannot_be_revived'
  | 'already_closed'
  | 'slot_limit'
  | 'already_added';

export type OpenAdditionOutcome =
  | { ok: true; addition: MidCampaignAddition; terms: MidCampaignTerms }
  | { ok: false; code: MidCampaignRefusal; message: string; next: string };

/**
 * The deliverable a Creator joining now can reasonably be asked for.
 *
 * §20 says "adjusted reasonable deliverables" and fixes no formula, and §1 rule 6
 * forbids inventing a commercial rule — so this composes a *sentence* from facts
 * that already exist (the remaining time and the close date) rather than
 * computing a required post count from a number nobody agreed. Admin can replace
 * it: the stored value is what the Creator was actually shown, whoever wrote it.
 */
export function describeAdjustedDeliverables(remainingHours: number, closeUtc: string): string {
  const days = Math.floor(remainingHours / 24);
  const hours = remainingHours % 24;
  const window =
    days > 0
      ? `${days} day${days === 1 ? '' : 's'}${hours > 0 ? ` and ${hours} hour${hours === 1 ? '' : 's'}` : ''}`
      : `${hours} hour${hours === 1 ? '' : 's'}`;
  return (
    `You would be joining with ${window} left — the campaign closes ${closeUtc} (UTC). ` +
    'Your deliverables are agreed for that remaining window rather than for a full campaign, ' +
    'and your first post is still verified the same way.'
  );
}

/**
 * Computes the terms a late Creator would be joining on. A read — it records
 * nothing, so a surface can show them before anybody commits.
 */
export async function readMidCampaignTerms(
  db: Database,
  campaignId: string,
  now: Date = new Date(),
): Promise<MidCampaignTerms | { code: MidCampaignRefusal }> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      campaignCloseAt: campaigns.campaignCloseAt,
      highEffort: campaigns.highEffort,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { code: 'campaign_not_found' };

  if ((UNREVIVABLE_STATUSES as readonly string[]).includes(campaign.status)) {
    return { code: 'cannot_be_revived' };
  }
  if (!(JOINABLE_STATUSES as readonly string[]).includes(campaign.status)) {
    return { code: 'not_live' };
  }

  const [build] = await db
    .select({ closesAt: campaignBuild.closesAt })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);

  const closeAt = campaign.campaignCloseAt ?? build?.closesAt ?? null;
  if (!closeAt) return { code: 'not_live' };

  const remainingMs = closeAt.getTime() - now.getTime();
  if (remainingMs <= 0) return { code: 'already_closed' };

  const remainingHours = Math.max(1, Math.floor(remainingMs / 3_600_000));
  const closeUtc = closeAt.toISOString().replace('T', ' ').slice(0, 16);

  return {
    campaignId,
    campaignCloseAt: closeAt.toISOString(),
    remainingHours,
    // §20: the campaign's *locked* result. §12's lock froze it at listing
    // payment; this is a copy of that, never a recomputation.
    highEffort: campaign.highEffort,
    adjustedDeliverables: describeAdjustedDeliverables(remainingHours, closeUtc),
  };
}

/**
 * Records the terms a mid-campaign Creator is being offered.
 *
 * Called once the association exists (through the ordinary §8 recruitment path
 * with `rosterIntent: 'mid_campaign'`). Refuses before the §2.2 cap is exceeded
 * rather than after — a Creator who reaches acceptance and is then told they
 * cannot activate has been asked to agree to something they could not do.
 */
export async function openMidCampaignAddition(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    associationId: string;
    /** Admin may replace the composed deliverable sentence with their own. */
    adjustedDeliverables?: string | undefined;
    actor: string;
  },
  now: Date = new Date(),
): Promise<OpenAdditionOutcome> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      prospectId: campaignAffiliateAssociations.prospectId,
      rosterMembership: campaignAffiliateAssociations.rosterMembership,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) {
    return {
      ok: false,
      code: 'campaign_not_found',
      message: 'We could not find that recruitment.',
      next: 'Reload the roster.',
    };
  }

  const terms = await readMidCampaignTerms(db, association.campaignId, now);
  if ('code' in terms) {
    return { ok: false, ...refusal(terms.code) };
  }

  // §2.2: the cap applies. Checked here, before the Creator is asked to accept.
  if (association.prospectId) {
    const usage = await readSlotUsage(db, association.prospectId);
    if (usage.used >= ACTIVE_PARTNERSHIP_SLOT_LIMIT) {
      return {
        ok: false,
        code: 'slot_limit',
        message: `This Creator already holds ${usage.used} active partnerships, which is the limit.`,
        next: 'Recruit someone else for this campaign, or wait until one of their campaigns closes.',
      };
    }
  }

  try {
    const [addition] = await db
      .insert(midCampaignAdditions)
      .values({
        associationId: association.id,
        campaignId: association.campaignId,
        campaignCloseAt: new Date(terms.campaignCloseAt),
        remainingHours: terms.remainingHours,
        highEffortAtJoin: terms.highEffort,
        adjustedDeliverables:
          input.adjustedDeliverables?.trim() || terms.adjustedDeliverables,
        openedBy: input.actor,
      })
      .returning();

    await deps.audit({
      action: 'mid_campaign.addition_opened',
      targetType: 'campaign_affiliate_association',
      targetId: association.id,
      internalReason:
        `§20 mid-campaign addition opened with ${terms.remainingHours} hours remaining; ` +
        `high-effort at join ${String(terms.highEffort)}. Public terms and other Creators' ` +
        'locked terms unchanged.',
      newValue: { remainingHours: terms.remainingHours, closeAt: terms.campaignCloseAt },
      actorId: input.actor,
    });

    return { ok: true, addition: addition!, terms };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'already_added',
        message: 'This Creator has already been given mid-campaign terms for this campaign.',
        next: 'Open their record to see the terms they were shown.',
      };
    }
    throw error;
  }
}

/* ── Activation (§20: "Set a new `activated_at`; no retroactive attribution") ─ */

export type ActivateOutcome =
  | { ok: true; activatedAt: string }
  | { ok: false; code: MidCampaignRefusal | 'not_ready' | 'no_link'; message: string; next: string };

/**
 * Activates a mid-campaign Creator's tracking link, now.
 *
 * The one thing that must not be reused from Phase 14a: `launchCampaign` sets
 * `activated_at = campaign_live_at`, which is right for the initial roster and
 * would be retroactive here. This sets it to the activation instant, so every
 * click already in the ledger is before it and the 14b ingest has already
 * recorded each of those as earning nothing.
 *
 * The association must be `ready` — the §16 readiness checklist is the same one
 * the initial roster passes, and §20 says "require agreements, compensation
 * acceptance, connected-account readiness, and all relevant Creator-readiness
 * items". Joining late relaxes none of it.
 */
export async function activateMidCampaignCreator(
  db: Database,
  deps: { audit: AuditWriter },
  input: { associationId: string; actor: string },
  now: Date = new Date(),
): Promise<ActivateOutcome> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      prospectId: campaignAffiliateAssociations.prospectId,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) {
    return {
      ok: false,
      code: 'campaign_not_found',
      message: 'We could not find that recruitment.',
      next: 'Reload the roster.',
    };
  }

  const terms = await readMidCampaignTerms(db, association.campaignId, now);
  if ('code' in terms) return { ok: false, ...refusal(terms.code) };

  if (association.status !== 'ready') {
    return {
      ok: false,
      code: 'not_ready',
      message: `This Creator is ${association.status}, not ready. Every readiness item applies to a mid-campaign Creator too.`,
      next: 'Finish the readiness checklist, then activate.',
    };
  }

  if (association.prospectId) {
    const usage = await readSlotUsage(db, association.prospectId);
    if (usage.used >= ACTIVE_PARTNERSHIP_SLOT_LIMIT) {
      return {
        ok: false,
        code: 'slot_limit',
        message: `This Creator already holds ${usage.used} active partnerships, which is the limit.`,
        next: 'They can join once one of their campaigns closes.',
      };
    }
  }

  const activated = await db.transaction(async (tx) => {
    const moved = await tx
      .update(trackingLinks)
      .set({ active: true, activatedAt: now })
      .where(
        and(
          eq(trackingLinks.associationId, association.id),
          eq(trackingLinks.active, false),
        ),
      )
      .returning({ id: trackingLinks.id, activatedAt: trackingLinks.activatedAt });
    if (moved.length === 0) return null;

    await transitionAssociation(association.id, 'ready', 'active', input.actor, tx);
    return moved[0]!;
  });

  if (!activated) {
    return {
      ok: false,
      code: 'no_link',
      message: 'This Creator has no inactive tracking link to activate.',
      next: 'Check whether they are already active.',
    };
  }

  await deps.audit({
    action: 'mid_campaign.activated',
    targetType: 'campaign_affiliate_association',
    targetId: association.id,
    internalReason:
      `§20 mid-campaign tracking link activated at ${now.toISOString()} — a new activation instant, ` +
      'so every click already recorded is before it and earns nothing (§33.6.13, §33.6.3).',
    newValue: { activatedAt: now.toISOString() },
    actorId: input.actor,
  });

  return { ok: true, activatedAt: now.toISOString() };
}

export async function readAddition(
  db: Database,
  associationId: string,
): Promise<MidCampaignAddition | null> {
  const [row] = await db
    .select()
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.associationId, associationId))
    .limit(1);
  return row ?? null;
}

export async function countAdditions(db: Database, campaignId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.campaignId, campaignId));
  return Number(row?.n ?? 0);
}

function refusal(code: MidCampaignRefusal): { code: MidCampaignRefusal; message: string; next: string } {
  switch (code) {
    case 'cannot_be_revived':
      return {
        code,
        message:
          'This campaign ended because no Creator accepted in time, and the Founder was refunded. It cannot be restarted by adding a Creator now.',
        next: 'The Founder starts a new campaign when they are ready.',
      };
    case 'already_closed':
      return {
        code,
        message: 'This campaign has already closed, so no one else can join it.',
        next: 'Nothing has changed.',
      };
    case 'not_live':
      return {
        code,
        message: 'Creators can only be added to a campaign that is live and has not closed.',
        next: 'Nothing has changed.',
      };
    default:
      return {
        code,
        message: 'We could not find that campaign.',
        next: 'Reload and try again.',
      };
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: string }).code === '23505'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
