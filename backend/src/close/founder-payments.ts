/**
 * The Founder W-9, the payment schedule, and early remaining release —
 * Spec §22.3, §24.5, §23.3, §33.8.9–§33.8.13 (Phase 19b).
 *
 * ── The release moves no provider money, and that is the configuration ──────
 * Under the approved direct-charge model the captured funds settled to the
 * Founder's OWN connected account at capture (§24.1), and no platform-side fee
 * was debited (19a's documented state). So §22.3's "release" is Proovd's
 * recorded decision that the eligible share is the Founder's to treat as
 * released — a payment object, the two §23.3 flags, the lifecycle move, and
 * the notice. There is no Transfer, no payout, and no gateway dependency in
 * this module at all; if the approved production model later collects the
 * platform-side fee, the release gains its provider leg without this contract
 * changing. Nothing here is a §3.2 account — Proovd never has the money.
 *
 * ── The eligible share is read, never recomputed (§22.3) ────────────────────
 * eligible share = captured pre-tax subtotal − Proovd 5% − FINALIZED Creator
 * percentage compensation − cause-based adjustments − Stripe fees allocated to
 * the Founder. Every term is a stored ledger column: the subtotal, fee, and
 * Stripe-fee aggregates were written at capture (18a), the Creator
 * compensation is 19a's finalized `affiliate_earned_cents`, and the
 * adjustments term is the sum of the §24.8 records that exist — Phase 20
 * writes those; until then the only honest value is zero. A payment refuses to
 * exist while any provisional amount is unresolved, because a share computed
 * over unfinalized earnings is a number that will change (§1.4).
 *
 * ── One resolver, many renderers (§33.8.13) ─────────────────────────────────
 * `readFounderPaymentStatus` is the ONE place the §22.3 status — exact amount
 * affected, named requirement or blocker, secure action, submitted/verified
 * state, next review date, `No action needed` while under review — is
 * composed. The Founder route, the Admin queue, the §26.6 money-control line,
 * and every email body render ITS output; none of them recomputes an amount.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  campaignStatusHistory,
} from '../db/schema/domain.js';
import {
  founderW9Records,
  founderW9Events,
  earlyReleaseEvidence,
  earlyReleaseRequests,
  founderPayments,
  type FounderW9Record,
  type FounderPayment,
  type EarlyReleaseEvidence,
  type EarlyReleaseRequest,
} from '../db/schema/founder-payments.js';
import { creatorCompletionDecisions } from '../db/schema/earnings.js';
import { refundCauseAllocations } from '../db/schema/refunds.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { readSettingValue } from '../settings/service.js';
import { campaignEnforcementHold } from '../support/enforcement-hold.js';
import { day14PaymentBlock } from '../fulfillment/payment-block.js';
import { dayAfterClose } from './creator-close.js';
import {
  canMoveW9State,
  W9_STATE_LINES,
  W9_SECURE_ACTION,
  W9_NO_ACTION_NEEDED,
  FOUNDER_PAYMENT_KIND_LABELS,
  FOUNDER_PAYMENT_SCHEDULES,
  EARLY_REMAINING_SETTING_KEY,
  EARLY_RELEASE_EVIDENCE_FACTS,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14,
  FOUNDER_SHARE_TAX_NOTE,
  eligibleFounderShareCents,
  founderPaymentAmountCents,
  type W9Status,
  type FounderPaymentKind,
  type FounderPaymentScheduleEntry,
} from './founder-payments-logic.js';
import {
  notifyW9Prompt,
  notifyW9Block,
  notifyFounderPaymentReleased,
  notifyEarlyRequestReceived,
  notifyEarlyRequestResult,
  notifyMoneyDecisionsDue,
  notifyDeliverableVerificationDue,
} from './founder-payment-notifications.js';

export interface FounderPaymentDeps {
  db: Database;
  audit: AuditWriter;
  /** Absent (some tests) → state still moves, nothing sends. */
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/** The lifecycle states in which §22.3 work exists at all — after close. */
export const POST_CLOSE_STATUSES = [
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
] as const;

/** Where a payment may be CREATED: charge/retry outcomes final (§22.3
    "after retry"), money work not yet past this payment's own stage. */
const CREATABLE_FROM: Record<FounderPaymentKind, readonly string[]> = {
  single_payment: ['closed_reconciling', 'captured_pending_w9'],
  first_payment: ['closed_reconciling', 'captured_pending_w9'],
  remaining_payment: ['first_payment_released', 'day_14_review'],
};

/** The lifecycle move each release performs (§23.1). */
const RELEASE_TRANSITION: Record<FounderPaymentKind, { from: readonly string[]; to: string }> = {
  single_payment: {
    from: ['closed_reconciling', 'captured_pending_w9'],
    to: 'single_payment_released',
  },
  first_payment: {
    from: ['closed_reconciling', 'captured_pending_w9'],
    to: 'first_payment_released',
  },
  remaining_payment: {
    from: ['first_payment_released', 'day_14_review'],
    to: 'remaining_payment_released',
  },
};

/** The 0015/0031 shape: a value shaped like a US TIN is a paste, not an answer. */
const TIN_PATTERNS = [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{2}-\d{7}\b/];
export function looksLikeTin(value: string): boolean {
  return TIN_PATTERNS.some((p) => p.test(value));
}

async function readNumberSetting(db: Database, key: string): Promise<number> {
  const value = await readSettingValue(db, key);
  if (typeof value !== 'number') {
    throw new Error(`setting ${key} is not a number`);
  }
  return value;
}

interface CampaignMoneyRow {
  id: string;
  type: 'pre_build' | 'pre_launch' | null;
  status: string;
  closeAt: Date | null;
  rewardSubtotalCapturedCents: bigint;
  totalCapturedCents: bigint;
  proovdFeeCents: bigint;
  affiliateProvisionalCents: bigint;
  affiliateEarnedCents: bigint;
  affiliateUnearnedReturnedCents: bigint;
  stripeFeeCents: bigint;
}

async function loadCampaignMoney(db: Database, campaignId: string): Promise<CampaignMoneyRow | null> {
  const [row] = await db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      status: sql<string>`${campaigns.status}::text`,
      closeAt: campaigns.campaignCloseAt,
      rewardSubtotalCapturedCents: campaigns.rewardSubtotalCapturedCents,
      totalCapturedCents: campaigns.totalCapturedCents,
      proovdFeeCents: campaigns.proovdFeeCents,
      affiliateProvisionalCents: campaigns.affiliateProvisionalCents,
      affiliateEarnedCents: campaigns.affiliateEarnedCents,
      affiliateUnearnedReturnedCents: campaigns.affiliateUnearnedReturnedCents,
      stripeFeeCents: campaigns.stripeFeeCents,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return (row as CampaignMoneyRow | undefined) ?? null;
}

/** §24.4's resolution as a fact: every provisioned cent is finalized into
    earned + returned. True when nothing was ever provisioned. */
function creatorEarningsResolved(campaign: CampaignMoneyRow): boolean {
  return (
    campaign.affiliateProvisionalCents ===
    campaign.affiliateEarnedCents + campaign.affiliateUnearnedReturnedCents
  );
}

/** §24.8's cause-based adjustments: the sum of the recorded Founder-liability
    amounts across the campaign's §24.8 cases (Phase 20a's insert-only
    `refund_cause_allocations`). A recorded judgement with its evidence, never
    a number this module derives (§1 rule 6) — this only sums the records. */
async function causeBasedAdjustmentsCents(db: Database, campaignId: string): Promise<bigint> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${refundCauseAllocations.founderLiabilityCents}), 0)`,
    })
    .from(refundCauseAllocations)
    .where(eq(refundCauseAllocations.campaignId, campaignId));
  return BigInt(row?.total ?? '0');
}

function shareFor(campaign: CampaignMoneyRow, exact: boolean, adjustmentsCents: bigint): bigint {
  return eligibleFounderShareCents({
    rewardSubtotalCapturedCents: campaign.rewardSubtotalCapturedCents,
    proovdFeeCents: campaign.proovdFeeCents,
    // Before finalization completes, the maximum provisioned is the honest
    // floor — the share can only grow as unearned amounts return (§24.4).
    finalizedCreatorCompensationCents: exact
      ? campaign.affiliateEarnedCents
      : campaign.affiliateProvisionalCents,
    causeBasedAdjustmentsCents: adjustmentsCents,
    stripeFeesAllocatedToFounderCents: campaign.stripeFeeCents,
  });
}

async function loadW9(db: Database, campaignId: string): Promise<FounderW9Record | null> {
  const [row] = await db
    .select()
    .from(founderW9Records)
    .where(eq(founderW9Records.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

async function loadPayments(db: Database, campaignId: string): Promise<FounderPayment[]> {
  return db.select().from(founderPayments).where(eq(founderPayments.campaignId, campaignId));
}

async function latestEvidence(db: Database, campaignId: string): Promise<EarlyReleaseEvidence | null> {
  const [row] = await db
    .select()
    .from(earlyReleaseEvidence)
    .where(eq(earlyReleaseEvidence.campaignId, campaignId))
    .orderBy(sql`${earlyReleaseEvidence.recordedAt} DESC`)
    .limit(1);
  return row ?? null;
}

function evidenceMissingFacts(evidence: EarlyReleaseEvidence | null): string[] {
  if (!evidence) return EARLY_RELEASE_EVIDENCE_FACTS.map((f) => f.key);
  const recorded: Record<string, boolean> = {
    delivery_available: evidence.deliveryAvailable,
    communication_sent: evidence.communicationSent,
    tax_payment_complete: evidence.taxPaymentComplete,
    no_immediate_risk: evidence.noImmediateRisk,
  };
  return EARLY_RELEASE_EVIDENCE_FACTS.filter((f) => !recorded[f.key]).map((f) => f.key);
}

/* ── The W-9 request (§22.3: "Immediately after close, request W-9") ───────── */

export type RequestW9Outcome =
  | { status: 'requested'; record: FounderW9Record }
  | { status: 'already_requested'; record: FounderW9Record }
  | { status: 'nothing_captured' }
  | { status: 'not_closed'; current: string }
  | { status: 'not_found' };

/**
 * Idempotent by the one-per-campaign unique index. Called from the close
 * batch's completion (the 08c reveal shape: after the transaction, idempotent,
 * a crash costs a retry) and re-driven by the schedule sweep.
 */
export async function requestFounderW9(
  deps: FounderPaymentDeps,
  input: { campaignId: string; actor: string; now?: Date },
): Promise<RequestW9Outcome> {
  const now = input.now ?? new Date();
  const campaign = await loadCampaignMoney(deps.db, input.campaignId);
  if (!campaign) return { status: 'not_found' };
  if (!(POST_CLOSE_STATUSES as readonly string[]).includes(campaign.status)) {
    return { status: 'not_closed', current: campaign.status };
  }
  // A campaign that captured nothing has no Founder payment coming — asking
  // for a tax form behind no payment is a burden nothing justifies (§1.4).
  // A retry-window campaign that recovers later is picked up by the sweep.
  if (campaign.totalCapturedCents === 0n) return { status: 'nothing_captured' };

  const inserted = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .insert(founderW9Records)
      .values({
        campaignId: input.campaignId,
        status: 'requested',
        requestedAt: now,
        requestedBy: input.actor,
      })
      .onConflictDoNothing()
      .returning();
    if (rows.length !== 1) return null;
    const [event] = await tx
      .insert(founderW9Events)
      .values({
        w9RecordId: rows[0]!.id,
        campaignId: input.campaignId,
        fromStatus: null,
        toStatus: 'requested',
        actor: input.actor,
        occurredAt: now,
      })
      .returning();
    return { record: rows[0]!, eventId: event!.id };
  });

  if (!inserted) {
    const existing = await loadW9(deps.db, input.campaignId);
    if (!existing) return { status: 'not_found' };
    return { status: 'already_requested', record: existing };
  }

  await deps.audit({
    action: 'founder_payments.w9_requested',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      '§22.3: W-9 requested immediately after close. A missing or unverified W-9 blocks every Founder payment (§33.8.9).',
    newValue: { w9RecordId: inserted.record.id },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyW9Prompt(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { campaignId: input.campaignId, w9EventId: inserted.eventId },
    );
  }

  return { status: 'requested', record: inserted.record };
}

/* ── Receipt and verification (§22.3's submitted/verified state) ───────────── */

export type W9SubmittedOutcome =
  | { status: 'recorded'; record: FounderW9Record }
  | { status: 'already_submitted' }
  | { status: 'already_verified' }
  | { status: 'tin_rejected' }
  | { status: 'not_requested' };

/**
 * Records that the form was RECEIVED through the secure route — an Admin's
 * recorded fact (§1.3), never a Founder self-assertion (§12's rule). The
 * reference names where the form is kept; a TIN-shaped value is refused here
 * by name and by the 0031 CHECK regardless.
 */
export async function recordW9Submitted(
  deps: FounderPaymentDeps,
  input: { campaignId: string; reference: string; actor: string; now?: Date },
): Promise<W9SubmittedOutcome> {
  const now = input.now ?? new Date();
  if (looksLikeTin(input.reference)) return { status: 'tin_rejected' };

  const record = await loadW9(deps.db, input.campaignId);
  if (!record) return { status: 'not_requested' };
  if (record.status === 'verified') return { status: 'already_verified' };
  if (record.status === 'submitted') return { status: 'already_submitted' };
  if (!canMoveW9State(record.status as W9Status, 'submitted')) return { status: 'not_requested' };

  const updated = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(founderW9Records)
      .set({
        status: 'submitted',
        submittedAt: now,
        submittedReference: input.reference.trim(),
        updatedAt: now,
      })
      .where(and(eq(founderW9Records.id, record.id), eq(founderW9Records.status, 'requested')))
      .returning();
    if (rows.length !== 1) return null;
    await tx.insert(founderW9Events).values({
      w9RecordId: record.id,
      campaignId: input.campaignId,
      fromStatus: 'requested',
      toStatus: 'submitted',
      actor: input.actor,
      occurredAt: now,
    });
    return rows[0]!;
  });
  if (!updated) return { status: 'already_submitted' };

  await deps.audit({
    action: 'founder_payments.w9_submitted',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§22.3: W-9 receipt recorded (reference: ${input.reference.trim()}). Under review; the Founder owes nothing while it is.`,
    newValue: { w9RecordId: record.id },
    actorId: input.actor,
  });

  return { status: 'recorded', record: updated };
}

export type W9DecisionOutcome =
  | { status: 'verified'; record: FounderW9Record }
  | { status: 'returned'; record: FounderW9Record }
  | { status: 'tin_rejected' }
  | { status: 'not_submitted'; current: string | null };

/** Verifies the submitted form, or returns it with the recorded reason. */
export async function decideW9(
  deps: FounderPaymentDeps,
  input: {
    campaignId: string;
    decision: 'verified' | 'resubmission_required';
    note: string;
    actor: string;
    now?: Date;
  },
): Promise<W9DecisionOutcome> {
  const now = input.now ?? new Date();
  if (looksLikeTin(input.note)) return { status: 'tin_rejected' };

  const record = await loadW9(deps.db, input.campaignId);
  if (!record || record.status !== 'submitted') {
    return { status: 'not_submitted', current: record?.status ?? null };
  }

  if (input.decision === 'verified') {
    const updated = await deps.db.transaction(async (tx) => {
      const rows = await tx
        .update(founderW9Records)
        .set({
          status: 'verified',
          verifiedAt: now,
          verifiedBy: input.actor,
          verificationNote: input.note.trim() || null,
          updatedAt: now,
        })
        .where(and(eq(founderW9Records.id, record.id), eq(founderW9Records.status, 'submitted')))
        .returning();
      if (rows.length !== 1) return null;
      await tx.insert(founderW9Events).values({
        w9RecordId: record.id,
        campaignId: input.campaignId,
        fromStatus: 'submitted',
        toStatus: 'verified',
        actor: input.actor,
        occurredAt: now,
      });
      return rows[0]!;
    });
    if (!updated) return { status: 'not_submitted', current: 'submitted' };

    await deps.audit({
      action: 'founder_payments.w9_verified',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `§22.3: W-9 verified by ${input.actor}. The W-9 block on Founder payments is lifted.`,
      newValue: { w9RecordId: record.id },
      actorId: input.actor,
    });
    return { status: 'verified', record: updated };
  }

  // Resubmission: back to `requested`, with the reason recorded. The prompt
  // dedups on the EVENT row, so a genuinely new request is a new message.
  const returned = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(founderW9Records)
      .set({
        status: 'requested',
        submittedAt: null,
        submittedReference: null,
        returnReason: input.note.trim(),
        updatedAt: now,
      })
      .where(and(eq(founderW9Records.id, record.id), eq(founderW9Records.status, 'submitted')))
      .returning();
    if (rows.length !== 1) return null;
    const [event] = await tx
      .insert(founderW9Events)
      .values({
        w9RecordId: record.id,
        campaignId: input.campaignId,
        fromStatus: 'submitted',
        toStatus: 'requested',
        actor: input.actor,
        reason: input.note.trim(),
        occurredAt: now,
      })
      .returning();
    return { record: rows[0]!, eventId: event!.id };
  });
  if (!returned) return { status: 'not_submitted', current: 'submitted' };

  await deps.audit({
    action: 'founder_payments.w9_returned',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§22.3: W-9 submission returned for resubmission: ${input.note.trim()}`,
    newValue: { w9RecordId: record.id },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyW9Prompt(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { campaignId: input.campaignId, w9EventId: returned.eventId, resubmission: true },
    );
  }
  return { status: 'returned', record: returned.record };
}

/* ── The §22.3 status — ONE resolver, many renderers (§33.8.13) ────────────── */

export interface FounderPaymentLine {
  kind: FounderPaymentKind;
  /** §3.1's customer-facing name — the internal key never renders. */
  label: string;
  percent: number;
  /** Exact when the share is exact; the floor amount otherwise. */
  amountCents: string;
  amountExact: boolean;
  status: 'blocked' | 'eligible' | 'released';
  /** Named, non-empty exactly when blocked — `blocked` without a reason is
      the word §22.3 forbids wearing a different spelling. */
  blockers: string[];
  /** The §22.3 secure action when the Founder owes one; null otherwise. */
  secureAction: string | null;
  /** §22.3: `No action needed` — true whenever the next move is Proovd's. */
  noActionNeeded: boolean;
  dueAt: string;
  releasedAt: string | null;
  releasedEarly: boolean;
}

export interface FounderPaymentStatusView {
  campaignId: string;
  model: 'idea' | 'product';
  campaignStatus: string;
  closedAt: string | null;
  currency: 'USD';
  applicable: boolean;
  notApplicableReason: string | null;
  w9: {
    state: 'not_requested' | W9Status;
    line: string;
    action: string;
    requestedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    returnReason: string | null;
    blocksPayments: boolean;
  };
  eligibleShare: {
    exact: boolean;
    amountCents: string;
    note: string;
    basis: {
      rewardSubtotalCapturedCents: string;
      proovdFeeCents: string;
      finalizedCreatorCompensationCents: string;
      causeBasedAdjustmentsCents: string;
      stripeFeesAllocatedToFounderCents: string;
    };
  };
  payments: FounderPaymentLine[];
  /** §22.3: the next review date — the earliest schedule/review instant still
      ahead of the released record. */
  nextReviewDate: string | null;
  /** Product only: the Day 14 status review — still due after an early
      release (§33.8.12). */
  day14: { dueAt: string; line: string } | null;
  earlyRelease: {
    settingEnabled: boolean;
    evidence: { id: string; recordedAt: string; missingFacts: string[] } | null;
    pendingRequest: { id: string; createdAt: string } | null;
    neverSkipsDay14: string;
  } | null;
}

export async function readFounderPaymentStatus(
  db: Database,
  input: { campaignId: string; now?: Date },
): Promise<FounderPaymentStatusView | null> {
  const now = input.now ?? new Date();
  const campaign = await loadCampaignMoney(db, input.campaignId);
  if (!campaign || !campaign.type) return null;
  const model: 'idea' | 'product' = campaign.type === 'pre_build' ? 'idea' : 'product';

  const postClose = (POST_CLOSE_STATUSES as readonly string[]).includes(campaign.status);
  const applicable = postClose && campaign.totalCapturedCents > 0n;
  const notApplicableReason = applicable
    ? null
    : campaign.status === 'ended_no_charge'
      ? 'This campaign ended without any charge, so no Founder payment exists.'
      : !postClose
        ? 'Founder payments begin after the campaign closes and charges settle (§22.3).'
        : 'No charge has been captured, so there is no Founder payment yet.';

  const w9 = await loadW9(db, input.campaignId);
  const w9State: 'not_requested' | W9Status = (w9?.status as W9Status | undefined) ?? 'not_requested';
  const w9Verified = w9State === 'verified';
  const w9View: FounderPaymentStatusView['w9'] = {
    state: w9State,
    line:
      w9State === 'not_requested'
        ? 'Proovd requests your W-9 immediately after close; it has not been requested yet.'
        : W9_STATE_LINES[w9State].line,
    action: w9State === 'not_requested' ? W9_NO_ACTION_NEEDED : W9_STATE_LINES[w9State].action,
    requestedAt: w9?.requestedAt.toISOString() ?? null,
    submittedAt: w9?.submittedAt?.toISOString() ?? null,
    verifiedAt: w9?.verifiedAt?.toISOString() ?? null,
    returnReason: w9?.returnReason ?? null,
    blocksPayments: !w9Verified,
  };

  const resolved = creatorEarningsResolved(campaign);
  const adjustments = await causeBasedAdjustmentsCents(db, input.campaignId);
  const share = shareFor(campaign, resolved, adjustments);
  const shareNote = resolved
    ? FOUNDER_SHARE_TAX_NOTE
    : `${FOUNDER_SHARE_TAX_NOTE} Creator earnings finalization is not complete, so this is the minimum: the exact share is fixed when every provisional Creator amount resolves (§24.4).`;

  const payments = await loadPayments(db, input.campaignId);
  const schedule = FOUNDER_PAYMENT_SCHEDULES[model];
  const settingEnabled =
    model === 'product' ? Boolean(await readSettingValue(db, EARLY_REMAINING_SETTING_KEY)) : false;
  const evidence = model === 'product' ? await latestEvidence(db, input.campaignId) : null;
  const [pendingRequest] =
    model === 'product'
      ? await db
          .select()
          .from(earlyReleaseRequests)
          .where(
            and(
              eq(earlyReleaseRequests.campaignId, input.campaignId),
              eq(earlyReleaseRequests.status, 'pending'),
            ),
          )
          .limit(1)
      : [];

  const lines: FounderPaymentLine[] = [];
  // §26.7 (Phase 20b): while the campaign stands suspended/killed, every
  // unreleased payment is blocked — with the hold NAMED, because `blocked`
  // without its reason is the forbidden word respelled (§22.3).
  const hold = await campaignEnforcementHold(db, input.campaignId);
  const holdBlocker = hold.restricted
    ? `Campaign enforcement hold — this campaign is ${hold.campaignStatus ?? 'suspended'} and unreleased payments are restricted while Proovd reviews it (§26.7).`
    : null;
  // §22.4 (Phase 21a): a failed Day 14 Progress Check blocks the unreleased
  // REMAINING payment on a Product campaign. Derived from the recorded review,
  // and named here so the Founder reads the same requirement the service
  // refuses with (19b's one-source rule).
  const day14 = await day14PaymentBlock(db, input.campaignId);

  let firstAmount: bigint | null = null;
  for (const entry of schedule) {
    const day = await readNumberSetting(db, entry.daySettingKey);
    const percent = await readNumberSetting(db, entry.percentSettingKey);
    const dueAt = campaign.closeAt ? dayAfterClose(campaign.closeAt, day) : now;
    const existing = payments.find((p) => p.kind === entry.kind);

    let amountCents: bigint;
    if (existing) {
      amountCents = existing.amountCents;
    } else {
      amountCents = founderPaymentAmountCents({
        kind: entry.kind,
        eligibleShareCents: share,
        percent,
        firstPaymentCents:
          entry.amountRule === 'remainder' ? (firstAmount ?? founderPaymentAmountCents({
            kind: 'first_payment',
            eligibleShareCents: share,
            percent: await readNumberSetting(db, 'product_first_payment_percent'),
          })) : undefined,
      });
    }
    if (entry.kind === 'first_payment') firstAmount = amountCents;

    const blockers: string[] = [];
    if (!existing) {
      if (!w9Verified) blockers.push('Verified W-9 — a missing or unverified W-9 blocks every Founder payment.');
      if (!resolved) blockers.push('Creator earnings finalization — the exact eligible share is fixed when it completes.');
      if (campaign.status === 'capture_retry_window' || campaign.status === 'closed_pending_capture') {
        blockers.push('The payment retry window has not ended.');
      }
      if (entry.kind === 'remaining_payment') {
        const first = payments.find((p) => p.kind === 'first_payment');
        if (!first || first.status !== 'released') {
          blockers.push('The first payment has not been released.');
        }
        if (now < dueAt) {
          blockers.push(
            settingEnabled
              ? `Day ${day} after close (${dueAt.toISOString().slice(0, 10)}) has not arrived — earlier release needs the recorded §22.3 evidence and an approved request.`
              : `Day ${day} after close (${dueAt.toISOString().slice(0, 10)}) has not arrived.`,
          );
        }
      } else if (now < dueAt) {
        blockers.push(`Day ${day} after close (${dueAt.toISOString().slice(0, 10)}) has not arrived.`);
      }
      if (entry.kind === 'single_payment') {
        blockers.push('Recorded payment and risk checks, and a named Admin approval (§22.3).');
      }
      if (blockers.length === 0 && !holdBlocker) {
        blockers.push('Proovd records the payment decision — no action needed from you.');
      }
    }

    let status: FounderPaymentLine['status'] = existing
      ? existing.status === 'released'
        ? 'released'
        : 'eligible'
      : 'blocked';
    // The hold blocks everything not already released — an existing `eligible`
    // payment cannot release while it stands, and saying `eligible` would
    // promise a release the service refuses (§1.4).
    if (holdBlocker && status !== 'released') {
      status = 'blocked';
      blockers.unshift(holdBlocker);
    }
    // §22.4's Product failure consequence. Applies only to the kinds the block
    // names — a first payment already released is not "unreleased", and
    // recovering it is §22.4's separate best-effort line, which is an
    // Admin-recorded §24.8 case (Phase 20a), never an automatic reversal.
    if (day14.blocked && day14.kinds.includes(entry.kind) && status !== 'released') {
      status = 'blocked';
      blockers.unshift(day14.blocker!);
    }
    lines.push({
      kind: entry.kind,
      label: FOUNDER_PAYMENT_KIND_LABELS[entry.kind],
      percent: existing?.percent ?? percent,
      amountCents: amountCents.toString(),
      amountExact: existing ? true : resolved,
      status,
      blockers: status === 'blocked' ? blockers : [],
      secureAction: status === 'blocked' && !w9Verified ? W9_SECURE_ACTION : null,
      noActionNeeded: !(status === 'blocked' && !w9Verified && w9State !== 'submitted'),
      dueAt: (existing?.dueAt ?? dueAt).toISOString(),
      releasedAt: existing?.releasedAt?.toISOString() ?? null,
      releasedEarly: existing?.releasedEarly ?? false,
    });
  }

  // §22.3: the next review date — the earliest still-open schedule instant,
  // and for Product the Day 14 review even when everything released early.
  const day14DueAt =
    model === 'product' && campaign.closeAt
      ? dayAfterClose(campaign.closeAt, await readNumberSetting(db, 'product_remaining_payment_day'))
      : null;
  const openDates: Date[] = lines
    .filter((l) => l.status !== 'released')
    .map((l) => new Date(l.dueAt));
  if (day14DueAt) openDates.push(day14DueAt);
  openDates.sort((a, b) => a.getTime() - b.getTime());
  const nextReviewDate = openDates.find((d) => d.getTime() >= now.getTime()) ?? openDates.at(-1) ?? null;

  return {
    campaignId: input.campaignId,
    model,
    campaignStatus: campaign.status,
    closedAt: campaign.closeAt?.toISOString() ?? null,
    currency: 'USD',
    applicable,
    notApplicableReason,
    w9: w9View,
    eligibleShare: {
      exact: resolved,
      amountCents: share.toString(),
      note: shareNote,
      basis: {
        rewardSubtotalCapturedCents: campaign.rewardSubtotalCapturedCents.toString(),
        proovdFeeCents: campaign.proovdFeeCents.toString(),
        finalizedCreatorCompensationCents: (resolved
          ? campaign.affiliateEarnedCents
          : campaign.affiliateProvisionalCents
        ).toString(),
        causeBasedAdjustmentsCents: adjustments.toString(),
        stripeFeesAllocatedToFounderCents: campaign.stripeFeeCents.toString(),
      },
    },
    payments: lines,
    nextReviewDate: nextReviewDate?.toISOString() ?? null,
    day14: day14DueAt
      ? {
          dueAt: day14DueAt.toISOString(),
          line: `The Day 14 Progress Check happens for every campaign on ${day14DueAt.toISOString().slice(0, 10)}. ${EARLY_RELEASE_NEVER_SKIPS_DAY_14}`,
        }
      : null,
    earlyRelease:
      model === 'product'
        ? {
            settingEnabled,
            evidence: evidence
              ? {
                  id: evidence.id,
                  recordedAt: evidence.recordedAt.toISOString(),
                  missingFacts: evidenceMissingFacts(evidence),
                }
              : null,
            pendingRequest: pendingRequest
              ? { id: pendingRequest.id, createdAt: pendingRequest.createdAt.toISOString() }
              : null,
            neverSkipsDay14: EARLY_RELEASE_NEVER_SKIPS_DAY_14,
          }
        : null,
  };
}

/* ── Creating a payment object (§22.3, §33.8.10, §33.8.11) ─────────────────── */

export type CreatePaymentOutcome =
  | { status: 'created'; payment: FounderPayment }
  | { status: 'already_exists'; payment: FounderPayment }
  | { status: 'wrong_model' }
  | { status: 'retry_incomplete'; current: string }
  | { status: 'not_creatable'; current: string }
  | { status: 'nothing_payable' }
  | { status: 'w9_missing' }
  | { status: 'w9_not_verified'; current: string }
  | { status: 'creator_earnings_not_finalized' }
  | { status: 'before_scheduled_day'; dueAt: Date }
  | { status: 'checks_missing' }
  | { status: 'approval_missing' }
  | { status: 'first_payment_not_released' }
  | { status: 'no_approved_early_request' }
  | { status: 'early_release_disabled' }
  | { status: 'before_day_3'; earliestAt: Date }
  | { status: 'evidence_incomplete'; missing: string[] }
  | { status: 'enforcement_hold'; campaignStatus: string }
  | { status: 'day_14_failed'; reasons: readonly string[] }
  | { status: 'not_found' };

export async function createFounderPayment(
  deps: FounderPaymentDeps,
  input: {
    campaignId: string;
    kind: FounderPaymentKind;
    checksNote?: string | undefined;
    approvedBy?: string | undefined;
    actor: string;
    now?: Date;
  },
): Promise<CreatePaymentOutcome> {
  const now = input.now ?? new Date();
  const campaign = await loadCampaignMoney(deps.db, input.campaignId);
  if (!campaign || !campaign.type || !campaign.closeAt) return { status: 'not_found' };
  const model: 'idea' | 'product' = campaign.type === 'pre_build' ? 'idea' : 'product';

  const entry: FounderPaymentScheduleEntry | undefined = FOUNDER_PAYMENT_SCHEDULES[model].find(
    (e) => e.kind === input.kind,
  );
  if (!entry) return { status: 'wrong_model' };

  if (campaign.status === 'capture_retry_window' || campaign.status === 'closed_pending_capture') {
    // §22.3: every schedule line starts "after retry".
    return { status: 'retry_incomplete', current: campaign.status };
  }
  // §26.7 (Phase 20b): a suspended/killed campaign holds unreleased funds.
  // Named BEFORE the generic state check, because `blocked` without its reason
  // is the forbidden word respelled (§22.3).
  const hold = await campaignEnforcementHold(deps.db, input.campaignId);
  if (hold.restricted) {
    return { status: 'enforcement_hold', campaignStatus: hold.campaignStatus ?? campaign.status };
  }
  // §22.4 (Phase 21a): a failed Day 14 blocks the unreleased remaining payment.
  // Refused by name, with the §22.4 findings — never a bare "blocked" (§22.3).
  const day14 = await day14PaymentBlock(deps.db, input.campaignId);
  if (day14.blocked && day14.kinds.includes(input.kind)) {
    return { status: 'day_14_failed', reasons: day14.reasons };
  }
  if (!CREATABLE_FROM[input.kind].includes(campaign.status)) {
    return { status: 'not_creatable', current: campaign.status };
  }

  // §33.8.9: the W-9 gate, first among the money gates.
  const w9 = await loadW9(deps.db, input.campaignId);
  if (!w9) return { status: 'w9_missing' };
  if (w9.status !== 'verified') return { status: 'w9_not_verified', current: w9.status };

  // §24.4: a share computed over unfinalized earnings is a number that will
  // change — refuse until every provisioned cent resolved (§1.4).
  if (!creatorEarningsResolved(campaign)) return { status: 'creator_earnings_not_finalized' };

  const share = shareFor(
    campaign,
    true,
    await causeBasedAdjustmentsCents(deps.db, input.campaignId),
  );
  if (share === 0n) return { status: 'nothing_payable' };

  const day = await readNumberSetting(deps.db, entry.daySettingKey);
  const percent = await readNumberSetting(deps.db, entry.percentSettingKey);
  const dueAt = dayAfterClose(campaign.closeAt, day);

  let firstPayment: FounderPayment | null = null;
  let releasedEarly = false;
  let earlyEvidenceId: string | null = null;

  if (input.kind === 'remaining_payment') {
    const [first] = await deps.db
      .select()
      .from(founderPayments)
      .where(
        and(
          eq(founderPayments.campaignId, input.campaignId),
          eq(founderPayments.kind, 'first_payment'),
        ),
      )
      .limit(1);
    if (!first || first.status !== 'released') return { status: 'first_payment_not_released' };
    firstPayment = first;

    if (now < dueAt) {
      // §22.3's early path: after Day 3 only, evidence-gated, disabled by
      // default, and decided per request by an Admin (§33.8.11).
      const enabled = Boolean(await readSettingValue(deps.db, EARLY_REMAINING_SETTING_KEY));
      if (!enabled) return { status: 'early_release_disabled' };
      if (now < first.dueAt) return { status: 'before_day_3', earliestAt: first.dueAt };
      const [approved] = await deps.db
        .select()
        .from(earlyReleaseRequests)
        .where(
          and(
            eq(earlyReleaseRequests.campaignId, input.campaignId),
            eq(earlyReleaseRequests.status, 'approved'),
          ),
        )
        .orderBy(sql`${earlyReleaseRequests.decidedAt} DESC`)
        .limit(1);
      if (!approved?.evidenceId) return { status: 'no_approved_early_request' };
      const [approvedEvidence] = await deps.db
        .select()
        .from(earlyReleaseEvidence)
        .where(eq(earlyReleaseEvidence.id, approved.evidenceId))
        .limit(1);
      const missing = evidenceMissingFacts(approvedEvidence ?? null);
      if (missing.length > 0) return { status: 'evidence_incomplete', missing };
      releasedEarly = true;
      earlyEvidenceId = approved.evidenceId;
    }
  } else if (now < dueAt) {
    return { status: 'before_scheduled_day', dueAt };
  }

  if (input.kind === 'single_payment') {
    // §22.3 Idea: "after retry, W-9, payment/risk checks, and Admin approval."
    // The checks are an Admin's recorded judgement — §31.7 forbids computing a
    // score to refuse automatically, so what is required is the record.
    if (!input.checksNote?.trim()) return { status: 'checks_missing' };
    if (!input.approvedBy?.trim()) return { status: 'approval_missing' };
  }

  const amountCents = founderPaymentAmountCents({
    kind: input.kind,
    eligibleShareCents: share,
    percent,
    firstPaymentCents: firstPayment?.amountCents,
  });

  const inserted = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .insert(founderPayments)
      .values({
        campaignId: input.campaignId,
        kind: input.kind,
        status: 'eligible',
        w9RecordId: w9.id,
        eligibleShareCents: share,
        percent,
        amountCents,
        campaignCloseAt: campaign.closeAt!,
        scheduledDay: day,
        dueAt,
        releasedEarly,
        earlyEvidenceId,
        paymentChecksNote: input.checksNote?.trim() || null,
        approvedBy: input.approvedBy?.trim() || null,
        createdBy: input.actor,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (rows.length !== 1) return null;

    // §26.6's "Founder share … giving what is actually payable": the exact
    // eligible share, written once it is exact. Idempotent — the inputs froze
    // at finalization, so every write lands the same number.
    await tx
      .update(campaigns)
      .set({ founderNetCents: share, updatedAt: now })
      .where(eq(campaigns.id, input.campaignId));

    // §23.3: eligibility is its own flag row, never a lifecycle value.
    await tx.insert(campaignPaymentFlags).values({
      campaignId: input.campaignId,
      flag: 'founder_payment_eligible',
      setAt: now,
      amountCents,
      actor: input.actor,
      evidence: {
        paymentId: rows[0]!.id,
        kind: input.kind,
        w9RecordId: w9.id,
        ...(earlyEvidenceId ? { earlyEvidenceId } : {}),
      },
    });
    return rows[0]!;
  });

  if (!inserted) {
    const [existing] = await deps.db
      .select()
      .from(founderPayments)
      .where(
        and(eq(founderPayments.campaignId, input.campaignId), eq(founderPayments.kind, input.kind)),
      )
      .limit(1);
    if (!existing) return { status: 'not_found' };
    return { status: 'already_exists', payment: existing };
  }

  await deps.audit({
    action: 'founder_payments.created',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      `§22.3 ${input.kind} recorded eligible: ${percent}% of the eligible share ${share} = ${amountCents} ` +
      `(share = captured pre-tax subtotal − 5% − finalized Creator compensation − adjustments − allocated Stripe fees; tax separate). ` +
      `W-9 verified (${w9.id}); due ${dueAt.toISOString()}${releasedEarly ? '; created through the §22.3 early evidence-gated path' : ''}` +
      `${input.approvedBy ? `; approved by ${input.approvedBy.trim()}` : ''}.`,
    newValue: { paymentId: inserted.id, kind: input.kind },
    actorId: input.actor,
  });

  return { status: 'created', payment: inserted };
}

/* ── Releasing a payment (§22.3, §23.1, §23.3) ─────────────────────────────── */

export type ReleasePaymentOutcome =
  | { status: 'released'; payment: FounderPayment }
  | { status: 'already_released'; payment: FounderPayment }
  | { status: 'not_releasable'; current: string }
  | { status: 'enforcement_hold'; campaignStatus: string }
  | { status: 'day_14_failed'; reasons: readonly string[] }
  | { status: 'not_found' };

export async function releaseFounderPayment(
  deps: FounderPaymentDeps,
  input: { campaignId: string; kind: FounderPaymentKind; actor: string; now?: Date },
): Promise<ReleasePaymentOutcome> {
  const now = input.now ?? new Date();
  const [payment] = await deps.db
    .select()
    .from(founderPayments)
    .where(
      and(eq(founderPayments.campaignId, input.campaignId), eq(founderPayments.kind, input.kind)),
    )
    .limit(1);
  if (!payment) return { status: 'not_found' };
  if (payment.status === 'released') return { status: 'already_released', payment };

  // §26.7 (Phase 20b): the release is the exact edge "restrict unreleased
  // funds" restricts. An already-released payment above is history (§29.7).
  const hold = await campaignEnforcementHold(deps.db, input.campaignId);
  if (hold.restricted) {
    return { status: 'enforcement_hold', campaignStatus: hold.campaignStatus ?? 'suspended' };
  }
  // §22.4: the same block, at the release edge. A payment created before the
  // review failed still cannot be released while the failure stands.
  const day14 = await day14PaymentBlock(deps.db, input.campaignId);
  if (day14.blocked && day14.kinds.includes(input.kind)) {
    return { status: 'day_14_failed', reasons: day14.reasons };
  }

  const campaign = await loadCampaignMoney(deps.db, input.campaignId);
  if (!campaign) return { status: 'not_found' };
  const transition = RELEASE_TRANSITION[input.kind];
  if (!transition.from.includes(campaign.status)) {
    // A suspended or killed campaign releases nothing — §26.7's block holds.
    return { status: 'not_releasable', current: campaign.status };
  }

  const released = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(founderPayments)
      .set({ status: 'released', releasedAt: now, releasedBy: input.actor, updatedAt: now })
      .where(and(eq(founderPayments.id, payment.id), eq(founderPayments.status, 'eligible')))
      .returning();
    if (rows.length !== 1) return null;

    const moved = await tx
      .update(campaigns)
      .set({ status: transition.to as typeof campaigns.$inferSelect.status, updatedAt: now })
      .where(
        and(
          eq(campaigns.id, input.campaignId),
          inArray(campaigns.status, [...transition.from] as (typeof campaigns.$inferSelect.status)[]),
        ),
      )
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: campaign.status as typeof campaigns.$inferSelect.status,
        toStatus: transition.to as typeof campaigns.$inferSelect.status,
        occurredAt: now,
        actor: input.actor,
      });
    }

    // §23.3: the paid fact is its own flag row with amount and evidence.
    await tx.insert(campaignPaymentFlags).values({
      campaignId: input.campaignId,
      flag: 'founder_payment_paid',
      setAt: now,
      amountCents: payment.amountCents,
      actor: input.actor,
      evidence: {
        paymentId: payment.id,
        kind: input.kind,
        releasedEarly: payment.releasedEarly,
      },
    });
    return rows[0]!;
  });
  if (!released) return { status: 'already_released', payment };

  await deps.audit({
    action: 'founder_payments.released',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      `§22.3 ${input.kind} released: ${payment.amountCents} of eligible share ${payment.eligibleShareCents}` +
      `${payment.releasedEarly ? ' — released early on recorded delivery/communication/tax/no-risk evidence; the Day 14 status review remains due (§33.8.12)' : ''}. ` +
      `Campaign moved to ${transition.to}. Under the approved direct-charge configuration the funds already settled to the Founder's account; this is the recorded release decision.`,
    newValue: { paymentId: payment.id, kind: input.kind },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyFounderPaymentReleased(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { payment: released },
    );
  }

  return { status: 'released', payment: released };
}

/* ── Early-release evidence and the request (§22.3, §33.8.11) ──────────────── */

export type RecordEvidenceOutcome =
  | { status: 'recorded'; evidence: EarlyReleaseEvidence; missing: string[] }
  | { status: 'detail_missing'; fact: string }
  | { status: 'wrong_model' }
  | { status: 'not_closed'; current: string }
  | { status: 'not_found' };

export async function recordEarlyReleaseEvidence(
  deps: FounderPaymentDeps,
  input: {
    campaignId: string;
    facts: Record<
      'delivery_available' | 'communication_sent' | 'tax_payment_complete' | 'no_immediate_risk',
      { recorded: boolean; detail: string }
    >;
    actor: string;
    now?: Date;
  },
): Promise<RecordEvidenceOutcome> {
  const now = input.now ?? new Date();
  const campaign = await loadCampaignMoney(deps.db, input.campaignId);
  if (!campaign || !campaign.type) return { status: 'not_found' };
  if (campaign.type !== 'pre_launch') return { status: 'wrong_model' };
  if (!(POST_CLOSE_STATUSES as readonly string[]).includes(campaign.status)) {
    return { status: 'not_closed', current: campaign.status };
  }

  for (const fact of EARLY_RELEASE_EVIDENCE_FACTS) {
    if (!input.facts[fact.key]?.detail?.trim()) {
      // Every answer needs its evidence — a bare boolean is internal
      // readiness, which §22.3 says is insufficient.
      return { status: 'detail_missing', fact: fact.key };
    }
  }

  const [evidence] = await deps.db
    .insert(earlyReleaseEvidence)
    .values({
      campaignId: input.campaignId,
      deliveryAvailable: input.facts.delivery_available.recorded,
      deliveryAvailableDetail: input.facts.delivery_available.detail.trim(),
      communicationSent: input.facts.communication_sent.recorded,
      communicationSentDetail: input.facts.communication_sent.detail.trim(),
      taxPaymentComplete: input.facts.tax_payment_complete.recorded,
      taxPaymentCompleteDetail: input.facts.tax_payment_complete.detail.trim(),
      noImmediateRisk: input.facts.no_immediate_risk.recorded,
      noImmediateRiskDetail: input.facts.no_immediate_risk.detail.trim(),
      recordedBy: input.actor,
      recordedAt: now,
    })
    .returning();

  const missing = evidenceMissingFacts(evidence!);
  await deps.audit({
    action: 'founder_payments.early_evidence_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      missing.length === 0
        ? '§22.3 early-release evidence recorded complete: delivery actually available to affected Backers, communication sent, tax/payment complete, no immediate risk flag.'
        : `§22.3 early-release evidence recorded incomplete — missing: ${missing.join(', ')}.`,
    newValue: { evidenceId: evidence!.id },
    actorId: input.actor,
  });

  return { status: 'recorded', evidence: evidence!, missing };
}

export type EarlyRequestOutcome =
  | { status: 'requested'; request: EarlyReleaseRequest }
  | { status: 'already_pending'; request: EarlyReleaseRequest }
  | { status: 'wrong_model' }
  | { status: 'not_closed'; current: string }
  | { status: 'not_found' };

/** The Founder's ask. Recording it promises nothing — the §6 setting's words:
    each request is evidence-gated and decided by an Admin. */
export async function requestEarlyRemaining(
  deps: FounderPaymentDeps,
  input: { campaignId: string; requestedBy: string; message: string; now?: Date },
): Promise<EarlyRequestOutcome> {
  const now = input.now ?? new Date();
  const campaign = await loadCampaignMoney(deps.db, input.campaignId);
  if (!campaign || !campaign.type) return { status: 'not_found' };
  if (campaign.type !== 'pre_launch') return { status: 'wrong_model' };
  if (!(POST_CLOSE_STATUSES as readonly string[]).includes(campaign.status)) {
    return { status: 'not_closed', current: campaign.status };
  }

  const [request] = await deps.db
    .insert(earlyReleaseRequests)
    .values({
      campaignId: input.campaignId,
      requestedBy: input.requestedBy,
      message: input.message.trim(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (!request) {
    const [pending] = await deps.db
      .select()
      .from(earlyReleaseRequests)
      .where(
        and(
          eq(earlyReleaseRequests.campaignId, input.campaignId),
          eq(earlyReleaseRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (pending) return { status: 'already_pending', request: pending };
    return { status: 'not_found' };
  }

  await deps.audit({
    action: 'founder_payments.early_release_requested',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§22.3 early remaining release requested by the Founder: ${input.message.trim()}`,
    newValue: { requestId: request.id },
    actorId: input.requestedBy,
  });

  if (deps.notifier && deps.context) {
    await notifyEarlyRequestReceived(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { request },
    );
  }
  return { status: 'requested', request };
}

export type EarlyDecisionOutcome =
  | { status: 'approved'; request: EarlyReleaseRequest }
  | { status: 'declined'; request: EarlyReleaseRequest }
  | { status: 'no_pending_request' }
  | { status: 'early_release_disabled' }
  | { status: 'w9_not_verified' }
  | { status: 'first_payment_not_released' }
  | { status: 'before_day_3'; earliestAt: Date }
  | { status: 'evidence_incomplete'; missing: string[] };

export async function decideEarlyRemaining(
  deps: FounderPaymentDeps,
  input: {
    campaignId: string;
    decision: 'approved' | 'declined';
    reason: string;
    actor: string;
    now?: Date;
  },
): Promise<EarlyDecisionOutcome> {
  const now = input.now ?? new Date();
  const [pending] = await deps.db
    .select()
    .from(earlyReleaseRequests)
    .where(
      and(
        eq(earlyReleaseRequests.campaignId, input.campaignId),
        eq(earlyReleaseRequests.status, 'pending'),
      ),
    )
    .limit(1);
  if (!pending) return { status: 'no_pending_request' };

  let evidenceId: string | null = null;
  if (input.decision === 'approved') {
    // §33.8.11's gates, each refusing by name.
    const enabled = Boolean(await readSettingValue(deps.db, EARLY_REMAINING_SETTING_KEY));
    if (!enabled) return { status: 'early_release_disabled' };
    const w9 = await loadW9(deps.db, input.campaignId);
    if (!w9 || w9.status !== 'verified') return { status: 'w9_not_verified' };
    const [first] = await deps.db
      .select()
      .from(founderPayments)
      .where(
        and(
          eq(founderPayments.campaignId, input.campaignId),
          eq(founderPayments.kind, 'first_payment'),
        ),
      )
      .limit(1);
    if (!first || first.status !== 'released') return { status: 'first_payment_not_released' };
    if (now < first.dueAt) return { status: 'before_day_3', earliestAt: first.dueAt };
    const evidence = await latestEvidence(deps.db, input.campaignId);
    const missing = evidenceMissingFacts(evidence);
    if (missing.length > 0) return { status: 'evidence_incomplete', missing };
    evidenceId = evidence!.id;
  }

  const [decided] = await deps.db
    .update(earlyReleaseRequests)
    .set({
      status: input.decision,
      decidedBy: input.actor,
      decidedAt: now,
      decisionReason: input.reason.trim(),
      evidenceId,
      updatedAt: now,
    })
    .where(and(eq(earlyReleaseRequests.id, pending.id), eq(earlyReleaseRequests.status, 'pending')))
    .returning();
  if (!decided) return { status: 'no_pending_request' };

  await deps.audit({
    action: 'founder_payments.early_release_decided',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      `§22.3 early remaining release ${input.decision}: ${input.reason.trim()}` +
      (evidenceId ? ` (evidence ${evidenceId}; the Day 14 status review remains due, §33.8.12)` : ''),
    newValue: { requestId: decided.id, decision: input.decision },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyEarlyRequestResult(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { request: decided },
    );
  }

  return input.decision === 'approved'
    ? { status: 'approved', request: decided }
    : { status: 'declined', request: decided };
}

/* ── The schedule sweep (§22.3, §27.6) ─────────────────────────────────────── */

export interface FounderPaymentSweepResult {
  w9Requested: number;
  w9Blocked: number;
  moneyDecisionsDue: number;
  deliverableVerificationDue: number;
}

/**
 * Safe to run twice: every send dedups, every move is a conditional UPDATE,
 * and the W-9 request is idempotent by its unique index.
 *
 *  - requests the W-9 for any post-close campaign with captured money and no
 *    record (recovery for the close-batch hook);
 *  - at the model's first schedule day, sends the §27.6 internal notices —
 *    `internal_money_decisions_due` (the Day 3 money work now has a §6-derived
 *    due time, which is what 19a was waiting for) and
 *    `internal_deliverable_verification_due` where completion decisions are
 *    missing — and, when the W-9 is not verified, moves the campaign to
 *    `captured_pending_w9` (§23.1's own state) and sends the W-9 block with
 *    the exact amount affected.
 */
export async function sweepFounderPaymentSchedule(
  deps: FounderPaymentDeps,
  now = new Date(),
): Promise<FounderPaymentSweepResult> {
  const result: FounderPaymentSweepResult = {
    w9Requested: 0,
    w9Blocked: 0,
    moneyDecisionsDue: 0,
    deliverableVerificationDue: 0,
  };

  // A) W-9 requests not yet made.
  const missingW9 = await deps.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .leftJoin(founderW9Records, eq(founderW9Records.campaignId, campaigns.id))
    .where(
      and(
        inArray(campaigns.status, ['capture_retry_window', 'closed_reconciling']),
        sql`${campaigns.totalCapturedCents} > 0`,
        isNull(founderW9Records.id),
      ),
    );
  for (const row of missingW9) {
    const outcome = await requestFounderW9(deps, {
      campaignId: row.id,
      actor: 'system:founder-payment-schedule',
      now,
    });
    if (outcome.status === 'requested') result.w9Requested += 1;
  }

  // B) first-schedule-day arrivals.
  const ideaDay = await readNumberSetting(deps.db, 'idea_single_payment_day');
  const productDay = await readNumberSetting(deps.db, 'product_first_payment_day');

  const due = await deps.db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      status: sql<string>`${campaigns.status}::text`,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(
      and(
        inArray(campaigns.status, ['closed_reconciling', 'captured_pending_w9']),
        sql`${campaigns.totalCapturedCents} > 0`,
        sql`${campaigns.campaignCloseAt} IS NOT NULL`,
      ),
    );

  for (const campaign of due) {
    if (!campaign.closeAt || !campaign.type) continue;
    const day = campaign.type === 'pre_build' ? ideaDay : productDay;
    const firstDueAt = dayAfterClose(campaign.closeAt, day);
    if (now < firstDueAt) continue;

    if (deps.notifier && deps.context) {
      const sent = await notifyMoneyDecisionsDue(
        { db: deps.db, notifier: deps.notifier, context: deps.context },
        { campaignId: campaign.id, day, dueAt: firstDueAt },
      );
      if (sent) result.moneyDecisionsDue += 1;
    }

    // Deliverable verification: any active-family association without a
    // recorded §22.1 completion decision when the money work comes due.
    const [undecided] = await deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignAffiliateAssociations)
      .leftJoin(
        creatorCompletionDecisions,
        eq(creatorCompletionDecisions.associationId, campaignAffiliateAssociations.id),
      )
      .where(
        and(
          eq(campaignAffiliateAssociations.campaignId, campaign.id),
          inArray(campaignAffiliateAssociations.status, ['active', 'paused']),
          isNull(creatorCompletionDecisions.id),
        ),
      );
    if ((undecided?.count ?? 0) > 0 && deps.notifier && deps.context) {
      const sent = await notifyDeliverableVerificationDue(
        { db: deps.db, notifier: deps.notifier, context: deps.context },
        { campaignId: campaign.id, missingCount: Number(undecided!.count) },
      );
      if (sent) result.deliverableVerificationDue += 1;
    }

    const w9 = await loadW9(deps.db, campaign.id);
    if (w9?.status !== 'verified') {
      // §23.1: "Founder charge result ready, W-9 missing" — the state exists
      // for exactly this moment.
      const moved = await deps.db.transaction(async (tx) => {
        const rows = await tx
          .update(campaigns)
          .set({ status: 'captured_pending_w9', updatedAt: now })
          .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'closed_reconciling')))
          .returning({ id: campaigns.id });
        if (rows.length === 1) {
          await tx.insert(campaignStatusHistory).values({
            campaignId: campaign.id,
            fromStatus: 'closed_reconciling',
            toStatus: 'captured_pending_w9',
            occurredAt: now,
            actor: 'system:founder-payment-schedule',
          });
          return true;
        }
        return false;
      });
      if (moved) {
        await deps.audit({
          action: 'founder_payments.w9_block_entered',
          targetType: 'campaign',
          targetId: campaign.id,
          internalReason:
            '§23.1: Founder charge result ready, W-9 missing — campaign moved to captured_pending_w9. Every Founder payment is blocked until the W-9 verifies (§33.8.9).',
          actorId: 'system:founder-payment-schedule',
        });
      }
      if (deps.notifier && deps.context) {
        const view = await readFounderPaymentStatus(deps.db, { campaignId: campaign.id, now });
        if (view) {
          const sent = await notifyW9Block(
            { db: deps.db, notifier: deps.notifier, context: deps.context },
            { campaignId: campaign.id, view },
          );
          if (sent) result.w9Blocked += 1;
        }
      }
    }
  }

  return result;
}
