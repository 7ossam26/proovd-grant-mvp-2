/**
 * The one-strike Founder ghost ban — Spec §22.7, §29.4, §33.10.4 (Phase 21a).
 *
 * This is the only permanent, unappealable sanction in the product, and the
 * phase brief states the stake exactly: a ban that fires on an undefined
 * condition is not recoverable for the Founder it hits. Everything here is
 * arranged around that.
 *
 * ── The trigger is evaluated, never asserted ────────────────────────────────
 * `gatherGhostBanFacts` reads stored timestamps and `ghostBanTriggersMet` — the
 * pure kernel, drift-tested against shared — decides. `recordGhostBan` refuses
 * by name when the claimed trigger is not among the met ones, so an Admin
 * cannot type a trigger into a form and have it stick. There is no
 * `other`/`discretionary` value in the enum, no free-text trigger column, and
 * no override parameter: "seems inactive" has nowhere to enter.
 *
 * ── The evidence for a trigger has to be a record ───────────────────────────
 * A `failed_day_14` ban is additionally refused by a 0034 trigger unless it
 * cites a Day 14 review of its own campaign whose outcome is actually `fail`.
 * The other three are time comparisons, and the evaluated facts are stored on
 * the ban row so the decision is reproducible years later.
 *
 * ── Permanent means there is no lift ────────────────────────────────────────
 * `founder_ghost_bans` has no UPDATE and no DELETE grant and no
 * `lifted_at`-shaped column. There is no `liftGhostBan` in this module and
 * writing one would be §1 rule 6 — §22.7 states the ban is permanent and names
 * no reversal.
 *
 * ── What the ban does NOT do ────────────────────────────────────────────────
 * It does not kill the campaign. §26.7's suspend/kill is Phase 20b's recorded
 * decision with its own reason category, customer explanation, and complete
 * effects, and building a second path into it here is exactly what "don't
 * rebuild what Phase 20 owns" forbids. §23.1's `banned_founder` entry rule is
 * "Enforcement also bans Founder", and the machine's only edge into it is from
 * `killed` — so this takes that edge when, and only when, the campaign has
 * already been killed through 20b's machinery.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderPayments } from '../db/schema/founder-payments.js';
import {
  campaignFulfillment,
  day14Reviews,
  deliveryCommitments,
  deliveryChangeRequests,
  founderGhostBans,
  type FounderGhostBan,
} from '../db/schema/fulfillment.js';
import type { AuditWriter } from '../auth/audit.js';
import { containsRawProviderCode } from '../admin/logic.js';
import { deliveryMonthEnd, loadFulfillmentFacts } from './service.js';
import {
  GHOST_BAN_PERMANENT_SENTENCE,
  GHOST_BAN_TRIGGERS,
  GHOST_BAN_TRIGGER_LABELS,
  ghostBanTriggersMet,
  type GhostBanFacts,
  type GhostBanTrigger,
} from './logic.js';

export interface GhostBanDeps {
  db: Database;
  audit: AuditWriter;
}

/* ── Gathering the facts §22.7's four triggers compare ─────────────────────── */

export interface GhostBanEvaluation {
  campaignId: string;
  founderUserId: string | null;
  facts: GhostBanFacts;
  triggersMet: readonly GhostBanTrigger[];
  labels: readonly string[];
  alreadyBanned: FounderGhostBan | null;
}

export async function gatherGhostBanFacts(
  db: Database,
  campaignId: string,
  now: Date = new Date(),
): Promise<GhostBanEvaluation | null> {
  const base = await loadFulfillmentFacts(db, campaignId);
  if (!base) return null;

  const [profile] = await db
    .select({ userId: founderClaimProfiles.claimedUserId })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, campaignId))
    .limit(1);

  const [review] = await db
    .select({ outcome: day14Reviews.outcome })
    .from(day14Reviews)
    .where(eq(day14Reviews.campaignId, campaignId))
    .limit(1);

  const [fulfillment] = await db
    .select({ deliveredAt: campaignFulfillment.deliveredAt })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, campaignId))
    .limit(1);

  const commitments = await db
    .select()
    .from(deliveryCommitments)
    .where(eq(deliveryCommitments.campaignId, campaignId))
    .orderBy(desc(deliveryCommitments.sequence));

  const original = commitments.find((c) => c.sequence === 1) ?? null;
  const revision = commitments.find((c) => c.sequence > 1) ?? null;

  const [lastUpdate] = await db
    .select({ publishedAt: campaignUpdates.publishedAt })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt))
    .limit(1);

  // §22.7's third trigger excuses a Founder who filed an updated timeline AND
  // completed the path §22.6 required of them. On the approval path that means
  // an approved request; on the notice path it means the Backers were told.
  let requiredNoticeOrApprovalComplete = false;
  if (revision) {
    if (revision.path === 'admin_preapproval' && revision.changeRequestId) {
      const [request] = await db
        .select({ status: deliveryChangeRequests.status })
        .from(deliveryChangeRequests)
        .where(eq(deliveryChangeRequests.id, revision.changeRequestId))
        .limit(1);
      requiredNoticeOrApprovalComplete =
        request?.status === 'approved' && revision.notifiedBackersAt !== null;
    } else {
      requiredNoticeOrApprovalComplete = revision.notifiedBackersAt !== null;
    }
  }

  const facts: GhostBanFacts = {
    campaignType: base.campaignType,
    day14Failed: review?.outcome === 'fail',
    paymentReleasedAt: base.anyPaymentReleasedAt,
    lastCommunicationAt: lastUpdate?.publishedAt ?? null,
    // Both delivery-window facts read the SAME original commitment; §22.7 gates
    // the Product trigger and the Idea trigger by campaign type in the kernel,
    // so an Idea campaign cannot fire the Product one whatever is stored here.
    disclosedDeliveryMonthEnd: original ? deliveryMonthEnd(original.deliveryMonth) : null,
    ideaDeliveryWindowEnd: original ? deliveryMonthEnd(original.deliveryMonth) : null,
    deliveredAt: fulfillment?.deliveredAt ?? null,
    updatedTimelineAt: revision?.recordedAt ?? null,
    requiredNoticeOrApprovalComplete,
    now,
  };

  const triggersMet = ghostBanTriggersMet(facts);

  const [existing] = profile?.userId
    ? await db
        .select()
        .from(founderGhostBans)
        .where(eq(founderGhostBans.founderUserId, profile.userId))
        .limit(1)
    : [];

  return {
    campaignId,
    founderUserId: profile?.userId ?? null,
    facts,
    triggersMet,
    labels: triggersMet.map((t) => GHOST_BAN_TRIGGER_LABELS[t]),
    alreadyBanned: existing ?? null,
  };
}

/* ── Recording the ban ─────────────────────────────────────────────────────── */

export type RecordGhostBanOutcome =
  | {
      status: 'banned';
      banId: string;
      trigger: GhostBanTrigger;
      campaignMovedTo: string | null;
      permanentSentence: string;
    }
  | { status: 'campaign_not_found' }
  | { status: 'no_founder_account' }
  | { status: 'unknown_trigger'; trigger: string }
  | { status: 'trigger_not_met'; trigger: string; met: readonly string[] }
  | { status: 'already_banned'; banId: string; trigger: string }
  | { status: 'missing_fields'; fields: readonly string[] }
  | { status: 'raw_provider_code_in_notice' };

/**
 * §22.7's ban. Refuses, by name, when:
 *
 *   * the trigger is not one of the four (there is no fifth to pass);
 *   * the trigger is not currently MET by the stored facts — §33.10.4;
 *   * this Founder already carries a ban (one strike, and the unique index
 *     refuses regardless);
 *   * any of §22.7's five recorded facts is blank;
 *   * the customer notice carries a raw provider or fraud code (§29.4,
 *     §33.9.11) — enforcement copy names actual behaviour and evidence.
 */
export async function recordGhostBan(
  deps: GhostBanDeps,
  input: {
    campaignId: string;
    trigger: string;
    evidence: string;
    notice: string;
    paymentRecoveryStatus: string;
    enforcementDecision: string;
    internalReason: string;
    actor: string;
    now?: Date;
  },
): Promise<RecordGhostBanOutcome> {
  if (!GHOST_BAN_TRIGGERS.includes(input.trigger as GhostBanTrigger)) {
    return { status: 'unknown_trigger', trigger: input.trigger };
  }
  const trigger = input.trigger as GhostBanTrigger;

  const missing = (
    [
      ['evidence', input.evidence],
      ['notice', input.notice],
      ['payment_recovery_status', input.paymentRecoveryStatus],
      ['enforcement_decision', input.enforcementDecision],
    ] as const
  )
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([key]) => key);
  if (missing.length > 0) return { status: 'missing_fields', fields: missing };

  if (containsRawProviderCode(input.notice)) return { status: 'raw_provider_code_in_notice' };

  const now = input.now ?? new Date();
  const evaluation = await gatherGhostBanFacts(deps.db, input.campaignId, now);
  if (!evaluation) return { status: 'campaign_not_found' };
  if (!evaluation.founderUserId) return { status: 'no_founder_account' };
  if (evaluation.alreadyBanned) {
    return {
      status: 'already_banned',
      banId: evaluation.alreadyBanned.id,
      trigger: evaluation.alreadyBanned.trigger,
    };
  }
  if (!evaluation.triggersMet.includes(trigger)) {
    // The whole of §33.10.4 lives on this line.
    return { status: 'trigger_not_met', trigger, met: evaluation.triggersMet };
  }

  const [review] = await deps.db
    .select({ id: day14Reviews.id })
    .from(day14Reviews)
    .where(and(eq(day14Reviews.campaignId, input.campaignId), eq(day14Reviews.outcome, 'fail')))
    .limit(1);

  const banId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(founderGhostBans)
      .values({
        founderUserId: evaluation.founderUserId!,
        campaignId: input.campaignId,
        trigger,
        evidence: input.evidence,
        notice: input.notice,
        paymentRecoveryStatus: input.paymentRecoveryStatus,
        enforcementDecision: input.enforcementDecision,
        internalReason: input.internalReason,
        triggerFacts: {
          ...evaluation.facts,
          paymentReleasedAt: evaluation.facts.paymentReleasedAt?.toISOString() ?? null,
          lastCommunicationAt: evaluation.facts.lastCommunicationAt?.toISOString() ?? null,
          disclosedDeliveryMonthEnd:
            evaluation.facts.disclosedDeliveryMonthEnd?.toISOString() ?? null,
          ideaDeliveryWindowEnd: evaluation.facts.ideaDeliveryWindowEnd?.toISOString() ?? null,
          deliveredAt: evaluation.facts.deliveredAt?.toISOString() ?? null,
          updatedTimelineAt: evaluation.facts.updatedTimelineAt?.toISOString() ?? null,
          now: now.toISOString(),
          triggersMet: evaluation.triggersMet,
        },
        day14ReviewId: trigger === 'failed_day_14' ? (review?.id ?? null) : null,
        decidedBy: input.actor,
        decidedAt: now,
      })
      .returning({ id: founderGhostBans.id });

    await deps.audit(
      {
        action: 'founder.ghost_ban_recorded',
        targetType: 'campaign',
        targetId: input.campaignId,
        actorId: input.actor,
        internalReason: input.internalReason,
        customerExplanation: input.notice,
        priorValue: { banned: false },
        newValue: {
          trigger,
          triggerLabel: GHOST_BAN_TRIGGER_LABELS[trigger],
          founderUserId: evaluation.founderUserId,
          permanent: true,
          paymentRecoveryStatus: input.paymentRecoveryStatus,
          enforcementDecision: input.enforcementDecision,
        },
      });

    return row!.id;
  });

  // §23.1's only edge into `banned_founder` is from `killed`. The kill itself is
  // §26.7's recorded decision (Phase 20b) — this takes the edge when it has
  // already happened and does nothing when it has not.
  const campaignMovedTo = await enterBannedFounder(deps, input.campaignId, input.actor, now);

  return {
    status: 'banned',
    banId,
    trigger,
    campaignMovedTo,
    permanentSentence: GHOST_BAN_PERMANENT_SENTENCE,
  };
}

async function enterBannedFounder(
  deps: GhostBanDeps,
  campaignId: string,
  actor: string,
  now: Date,
): Promise<string | null> {
  return deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: sql<string>`${campaigns.status}::text` })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (current?.status !== 'killed') return null;

    const moved = await tx
      .update(campaigns)
      .set({ status: 'banned_founder', updatedAt: now })
      .where(and(eq(campaigns.id, campaignId), sql`${campaigns.status}::text = 'killed'`))
      .returning({ id: campaigns.id });
    if (moved.length !== 1) return null;

    await tx.insert(campaignStatusHistory).values({
      campaignId,
      fromStatus: 'killed' as never,
      toStatus: 'banned_founder' as never,
      actor,
    });

    return 'banned_founder';
  });
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/**
 * Whether this Founder carries a permanent ban. Phase 21b's next-campaign
 * readiness reads it — a banned Founder never becomes eligible, whatever the
 * cooldown says (§22.7, §22.10's two independent gates).
 */
export async function founderIsBanned(
  db: Pick<Database, 'select'>,
  founderUserId: string,
): Promise<FounderGhostBan | null> {
  const [row] = await db
    .select()
    .from(founderGhostBans)
    .where(eq(founderGhostBans.founderUserId, founderUserId))
    .limit(1);
  return row ?? null;
}

export interface GhostBanCandidate {
  campaignId: string;
  campaignTitle: string | null;
  founderUserId: string | null;
  triggersMet: readonly GhostBanTrigger[];
  labels: readonly string[];
  alreadyBanned: boolean;
}

/**
 * The Admin candidate list. Every row here has at least one MET trigger — the
 * queue cannot suggest a ban that the record would not support, which is the
 * queue-shaped half of §33.10.4.
 */
export async function readGhostBanCandidates(
  db: Database,
  now: Date = new Date(),
): Promise<GhostBanCandidate[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      title: campaignBuild.title,
    })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .where(
      inArray(campaigns.status, [
        'closed_reconciling',
        'captured_pending_w9',
        'single_payment_released',
        'first_payment_released',
        'day_14_review',
        'remaining_payment_released',
        'suspended',
        'killed',
      ] as never[]),
    );

  const out: GhostBanCandidate[] = [];
  for (const row of rows) {
    const evaluation = await gatherGhostBanFacts(db, row.id, now);
    if (!evaluation || evaluation.triggersMet.length === 0) continue;
    out.push({
      campaignId: row.id,
      campaignTitle: row.title ?? null,
      founderUserId: evaluation.founderUserId,
      triggersMet: evaluation.triggersMet,
      labels: evaluation.labels,
      alreadyBanned: evaluation.alreadyBanned !== null,
    });
  }
  return out;
}
