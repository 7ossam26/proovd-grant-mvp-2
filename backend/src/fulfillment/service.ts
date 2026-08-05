/**
 * Fulfillment and delivery-date changes — Spec §22.5, §22.6, §33.10.1,
 * §33.10.2 (Phase 21a).
 *
 * ── The original promise is preserved by having nowhere to go ───────────────
 * `delivery_commitments` is an insert-only sequence. Sequence 1 is what the
 * Backer agreed to and is the row the delivery notice, the evidence packet,
 * and §22.7's third trigger all read. A revision is `sequence + 1`; the 0034
 * trigger refuses to move a recorded date, month, wording, reason, or path, and
 * DELETE is revoked. So §33.10.2's "preserves the original" is not a rule the
 * service remembers to obey — there is no statement that would break it.
 *
 * ── The approval path is derived, and the row cannot fake it ────────────────
 * §22.6 gives two paths and which applies is a fact about the campaign, not a
 * choice: `deliveryChangePathFor` reads the type and whether the remaining
 * payment released. `applyDeliveryRevision` is the ONE door — a door per path
 * would let a caller pick which rules apply by picking a URL, which is 17b's
 * reasoning for one live-edit route. On the approval path the revision must
 * cite an APPROVED request for its own campaign, and that is checked in the
 * service AND by a 0034 trigger, because "notify Backers, ask later" is exactly
 * the sequence §22.6 exists to forbid.
 *
 * ── The delivery notice is one resolver, five required items ────────────────
 * §22.5 lists what the Backer's delivery email repeats and §33.10.1 tests it.
 * `resolveDeliveryNotice` throws on a blank item, so a delivery message with no
 * access instructions cannot be sent at all rather than being sent empty. The
 * original commitment is a required input: the revised date is what every other
 * surface shows, and this is the message where the original has to survive.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory, campaignPaymentFlags } from '../db/schema/domain.js';
import { reservations } from '../db/schema/domain.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { founderPayments } from '../db/schema/founder-payments.js';
import {
  campaignFulfillment,
  deliveryCommitments,
  deliveryChangeRequests,
  type DeliveryCommitment,
} from '../db/schema/fulfillment.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { businessDayDeadline } from '../launch/business-calendar.js';
import { containsRawProviderCode } from '../admin/logic.js';
import { notifyDelivery } from './notifications.js';
import {
  CLOSE_CONFIRMATION_WINDOW_HOURS,
  DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS,
  DELIVERY_MECHANISMS,
  DELIVERY_MECHANISM_LABELS,
  FOUNDER_FULFILLMENT_OBLIGATIONS,
  closeConfirmationState,
  deliveryChangePathFor,
  evaluateUpdateCadence,
  missingMaterialUpdateFields,
  type CampaignType,
  type DeliveryChangePath,
  type DeliveryMechanism,
  type ObligationState,
} from './logic.js';

export interface FulfillmentDeps {
  db: Database;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

/** Statuses in which a charge has actually been captured for this campaign. */
const EVER_CAPTURED = ['captured', 'refunded', 'reversed', 'disputed'] as const;

/* ── Campaign facts every §22.5/§22.6 decision reads ───────────────────────── */

export interface FulfillmentCampaignFacts {
  campaignId: string;
  campaignType: CampaignType;
  status: string;
  closeAt: Date | null;
  /** The capture instant §22.5's cadence anchors on — the earliest capture. */
  chargedAt: Date | null;
  anyCaptured: boolean;
  remainingPaymentReleased: boolean;
  anyPaymentReleasedAt: Date | null;
}

export async function loadFulfillmentFacts(
  db: Database,
  campaignId: string,
): Promise<FulfillmentCampaignFacts | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      type: sql<string | null>`${campaigns.type}::text`,
      status: sql<string>`${campaigns.status}::text`,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign || !campaign.type) return null;

  const [captured] = await db
    .select({
      // The FIRST capture is the charge the 30-day cadence runs from: a later
      // recovery inside the retry window must not restart everyone's clock.
      firstCapturedAt: sql<Date | null>`min(${reservations.capturedAt})`,
      count: sql<number>`count(*)::int`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, campaignId),
        inArray(reservations.status, [...EVER_CAPTURED] as never[]),
      ),
    );

  const payments = await db
    .select({
      kind: founderPayments.kind,
      releasedAt: founderPayments.releasedAt,
    })
    .from(founderPayments)
    .where(eq(founderPayments.campaignId, campaignId));

  const released = payments.filter((p) => p.releasedAt !== null);
  const remainingPaymentReleased = released.some((p) => p.kind === 'remaining_payment');
  const anyPaymentReleasedAt = released.reduce<Date | null>((earliest, p) => {
    if (!p.releasedAt) return earliest;
    return !earliest || p.releasedAt.getTime() < earliest.getTime() ? p.releasedAt : earliest;
  }, null);

  return {
    campaignId,
    campaignType: campaign.type as CampaignType,
    status: campaign.status,
    closeAt: campaign.closeAt,
    chargedAt: captured?.firstCapturedAt ? new Date(captured.firstCapturedAt) : null,
    anyCaptured: (captured?.count ?? 0) > 0,
    remainingPaymentReleased,
    anyPaymentReleasedAt,
  };
}

/* ── The commitment sequence (§22.5's fourth obligation) ───────────────────── */

/** The first day of a month, as the `date` column stores it. */
function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

/** The last instant of a disclosed delivery month — §22.7's third trigger reads it. */
export function deliveryMonthEnd(month: string): Date {
  const start = new Date(`${monthStart(month)}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export async function listDeliveryCommitments(
  db: Database,
  campaignId: string,
): Promise<DeliveryCommitment[]> {
  return db
    .select()
    .from(deliveryCommitments)
    .where(eq(deliveryCommitments.campaignId, campaignId))
    .orderBy(asc(deliveryCommitments.sequence));
}

export type RecordOriginalOutcome =
  | { status: 'recorded'; commitment: DeliveryCommitment }
  | { status: 'already_recorded'; commitment: DeliveryCommitment }
  | { status: 'campaign_not_found' }
  | { status: 'invalid_month' };

/**
 * Records sequence 1 — the original promise, as disclosed on the campaign page.
 *
 * Idempotent by the (campaign, sequence) unique index: a second call returns
 * the first row unchanged rather than writing a second "original", which is
 * how a re-run of the close sweep stays safe.
 */
export async function recordOriginalCommitment(
  deps: FulfillmentDeps,
  input: {
    campaignId: string;
    /** Any date inside the disclosed month; stored normalised to its first day. */
    deliveryMonth: string;
    deliveryDate?: string | null;
    commitmentText: string;
    actor: string;
  },
): Promise<RecordOriginalOutcome> {
  const existing = await listDeliveryCommitments(deps.db, input.campaignId);
  const original = existing.find((c) => c.sequence === 1);
  if (original) return { status: 'already_recorded', commitment: original };

  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(input.deliveryMonth)) return { status: 'invalid_month' };

  const [campaign] = await deps.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { status: 'campaign_not_found' };

  const [row] = await deps.db
    .insert(deliveryCommitments)
    .values({
      campaignId: input.campaignId,
      sequence: 1,
      deliveryMonth: monthStart(input.deliveryMonth),
      deliveryDate: input.deliveryDate ?? null,
      commitmentText: input.commitmentText,
      recordedBy: input.actor,
    })
    .returning();

  await deps.audit({
    action: 'fulfillment.original_commitment_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason: '§22.5: the original delivery commitment, preserved as sequence 1.',
    newValue: { deliveryMonth: row!.deliveryMonth, deliveryDate: row!.deliveryDate },
  });

  return { status: 'recorded', commitment: row! };
}

/**
 * Derives the original commitment from the approved build when the Founder has
 * not recorded one explicitly. §14.4 already collects `deliveryWindow` and each
 * reward's `delivery` text; this reads them rather than asking the Founder to
 * retype a promise the Backer has already seen.
 */
export async function buildDisclosedCommitmentText(
  db: Database,
  campaignId: string,
): Promise<string | null> {
  const [build] = await db
    .select({ deliveryWindow: campaignBuild.deliveryWindow })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  if (build?.deliveryWindow && build.deliveryWindow.trim().length > 0) {
    return build.deliveryWindow;
  }
  const [reward] = await db
    .select({ delivery: campaignRewardPackages.delivery })
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, campaignId))
    .orderBy(asc(campaignRewardPackages.sortOrder))
    .limit(1);
  return reward?.delivery ?? null;
}

/* ── §22.6 — the Admin-approval path ───────────────────────────────────────── */

export interface DeliveryChangeFields {
  proposedDeliveryMonth: string;
  proposedDeliveryDate?: string | null;
  reason: string;
  unchangedObligations: string;
  nextUpdateDate: string;
  supportRefundRoute: string;
}

export type RequestDeliveryChangeOutcome =
  | {
      status: 'requested';
      requestId: string;
      reviewDueAt: Date;
      path: DeliveryChangePath;
    }
  | { status: 'not_required'; path: DeliveryChangePath }
  | { status: 'campaign_not_found' }
  | { status: 'no_original_commitment' }
  | { status: 'already_pending'; requestId: string }
  | { status: 'missing_fields'; fields: readonly string[] };

/**
 * §22.6's first branch: a Product campaign whose remaining payment has not
 * released asks Admin BEFORE Backers hear anything.
 *
 * A campaign on the notice path is answered `not_required` and told to file the
 * notice — not silently given a request row, because a review nobody owes is a
 * delay nobody agreed to, and the 0034 CHECK refuses the row anyway.
 */
export async function requestDeliveryChange(
  deps: FulfillmentDeps,
  input: DeliveryChangeFields & { campaignId: string; actor: string; now?: Date },
): Promise<RequestDeliveryChangeOutcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const path = deliveryChangePathFor({
    campaignType: facts.campaignType,
    remainingPaymentReleased: facts.remainingPaymentReleased,
  });
  if (path !== 'admin_preapproval') return { status: 'not_required', path };

  const commitments = await listDeliveryCommitments(deps.db, input.campaignId);
  if (!commitments.some((c) => c.sequence === 1)) return { status: 'no_original_commitment' };

  const missing = missingMaterialUpdateFields({
    previous_date: commitments[commitments.length - 1]!.deliveryMonth,
    revised_date: input.proposedDeliveryMonth,
    reason: input.reason,
    unchanged_obligations: input.unchangedObligations,
    next_update_date: input.nextUpdateDate,
    support_refund_route: input.supportRefundRoute,
  });
  if (missing.length > 0) return { status: 'missing_fields', fields: missing };

  const [pending] = await deps.db
    .select({ id: deliveryChangeRequests.id })
    .from(deliveryChangeRequests)
    .where(
      and(
        eq(deliveryChangeRequests.campaignId, input.campaignId),
        eq(deliveryChangeRequests.status, 'pending'),
      ),
    )
    .limit(1);
  if (pending) return { status: 'already_pending', requestId: pending.id };

  const now = input.now ?? new Date();
  // §22.6: "Admin reviews within five business days" — a business-day deadline,
  // so §29.6 governs it: committed calendar, stored with its version, and the
  // 0034 trigger refuses to move it afterwards.
  const deadline = businessDayDeadline(now, DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS);

  const [row] = await deps.db
    .insert(deliveryChangeRequests)
    .values({
      campaignId: input.campaignId,
      path: 'admin_preapproval',
      proposedDeliveryMonth: monthStart(input.proposedDeliveryMonth),
      proposedDeliveryDate: input.proposedDeliveryDate ?? null,
      reason: input.reason,
      unchangedObligations: input.unchangedObligations,
      nextUpdateDate: input.nextUpdateDate,
      supportRefundRoute: input.supportRefundRoute,
      reviewDueAt: deadline.dueAt,
      calendarVersion: deadline.calendarVersion,
      requestedBy: input.actor,
    })
    .returning({ id: deliveryChangeRequests.id });

  await deps.audit({
    action: 'fulfillment.delivery_change_requested',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason:
      '§22.6: Product delivery-date change before the remaining payment — Admin approval required before Backers are notified.',
    newValue: {
      proposedDeliveryMonth: monthStart(input.proposedDeliveryMonth),
      reviewDueAt: deadline.dueAt.toISOString(),
      calendarVersion: deadline.calendarVersion,
    },
  });

  return { status: 'requested', requestId: row!.id, reviewDueAt: deadline.dueAt, path };
}

export type DecideDeliveryChangeOutcome =
  | { status: 'approved'; commitmentId: string }
  | { status: 'rejected' }
  | { status: 'not_found' }
  | { status: 'already_decided'; decision: string }
  | { status: 'raw_provider_code_in_explanation' };

/**
 * §22.6: Admin reviews "for bait-and-switch risk and payment impact". Both
 * findings are recorded because they are two separate judgements — a change
 * that is honest but wrecks the payment schedule and one that is a
 * bait-and-switch are different problems with different consequences.
 *
 * An approval creates the next commitment sequence in the SAME transaction and
 * points the request at it: an approved request with no resulting commitment is
 * CHECK-refused, so "approved but never filed" is not a state.
 */
export async function decideDeliveryChange(
  deps: FulfillmentDeps,
  input: {
    requestId: string;
    decision: 'approved' | 'rejected';
    baitAndSwitchFinding: string;
    paymentImpactFinding: string;
    internalReason: string;
    customerExplanation: string;
    commitmentText?: string;
    actor: string;
    now?: Date;
  },
): Promise<DecideDeliveryChangeOutcome> {
  if (containsRawProviderCode(input.customerExplanation)) {
    return { status: 'raw_provider_code_in_explanation' };
  }

  const [request] = await deps.db
    .select()
    .from(deliveryChangeRequests)
    .where(eq(deliveryChangeRequests.id, input.requestId))
    .limit(1);
  if (!request) return { status: 'not_found' };
  if (request.status !== 'pending') return { status: 'already_decided', decision: request.status };

  const now = input.now ?? new Date();

  return deps.db.transaction(async (tx) => {
    if (input.decision === 'rejected') {
      const moved = await tx
        .update(deliveryChangeRequests)
        .set({
          status: 'rejected',
          baitAndSwitchFinding: input.baitAndSwitchFinding,
          paymentImpactFinding: input.paymentImpactFinding,
          decisionInternalReason: input.internalReason,
          decisionCustomerExplanation: input.customerExplanation,
          decidedBy: input.actor,
          decidedAt: now,
        })
        .where(
          and(eq(deliveryChangeRequests.id, input.requestId), eq(deliveryChangeRequests.status, 'pending')),
        )
        .returning({ id: deliveryChangeRequests.id });
      if (moved.length !== 1) return { status: 'already_decided', decision: 'unknown' };

      await deps.audit(
        {
          action: 'fulfillment.delivery_change_rejected',
          targetType: 'campaign',
          targetId: request.campaignId,
          actorId: input.actor,
          internalReason: input.internalReason,
          customerExplanation: input.customerExplanation,
          priorValue: { status: 'pending' },
          newValue: { status: 'rejected' },
        });
      return { status: 'rejected' };
    }

    const existing = await tx
      .select({ sequence: deliveryCommitments.sequence, month: deliveryCommitments.deliveryMonth })
      .from(deliveryCommitments)
      .where(eq(deliveryCommitments.campaignId, request.campaignId))
      .orderBy(desc(deliveryCommitments.sequence));
    const nextSequence = (existing[0]?.sequence ?? 0) + 1;

    // The request must be `approved` before the commitment cites it — the 0034
    // authorisation trigger reads the request's CURRENT status.
    await tx
      .update(deliveryChangeRequests)
      .set({
        status: 'approved',
        baitAndSwitchFinding: input.baitAndSwitchFinding,
        paymentImpactFinding: input.paymentImpactFinding,
        decisionInternalReason: input.internalReason,
        decisionCustomerExplanation: input.customerExplanation,
        decidedBy: input.actor,
        decidedAt: now,
        // Set below, after the commitment exists; the FK is DEFERRABLE.
      })
      .where(
        and(eq(deliveryChangeRequests.id, input.requestId), eq(deliveryChangeRequests.status, 'pending')),
      );

    const [commitment] = await tx
      .insert(deliveryCommitments)
      .values({
        campaignId: request.campaignId,
        sequence: nextSequence,
        deliveryMonth: request.proposedDeliveryMonth,
        deliveryDate: request.proposedDeliveryDate,
        commitmentText:
          input.commitmentText && input.commitmentText.trim().length > 0
            ? input.commitmentText
            : `Revised delivery: ${request.proposedDeliveryMonth.slice(0, 7)}`,
        reason: request.reason,
        path: 'admin_preapproval',
        changeRequestId: request.id,
        recordedBy: input.actor,
      })
      .returning({ id: deliveryCommitments.id });

    await tx
      .update(deliveryChangeRequests)
      .set({ resultingCommitmentId: commitment!.id })
      .where(eq(deliveryChangeRequests.id, input.requestId));

    await deps.audit(
      {
        action: 'fulfillment.delivery_change_approved',
        targetType: 'campaign',
        targetId: request.campaignId,
        actorId: input.actor,
        internalReason: input.internalReason,
        customerExplanation: input.customerExplanation,
        priorValue: { deliveryMonth: existing[0]?.month ?? null },
        newValue: { deliveryMonth: request.proposedDeliveryMonth, sequence: nextSequence },
      });

    return { status: 'approved', commitmentId: commitment!.id };
  });
}

/* ── §22.6 — the one door that revises a delivery date ─────────────────────── */

export type ApplyRevisionOutcome =
  | { status: 'revised'; commitmentId: string; updateId: string; path: DeliveryChangePath }
  | { status: 'campaign_not_found' }
  | { status: 'no_original_commitment' }
  | { status: 'admin_approval_required'; path: DeliveryChangePath }
  | { status: 'approval_not_granted' }
  | { status: 'missing_fields'; fields: readonly string[] };

/**
 * The ONE door that moves a delivery date, whichever path governs.
 *
 * On `admin_preapproval` it refuses without an approved request, by name. On
 * `notice_before_original_month` it needs no approval — §22.6 says so — but it
 * still needs all six material-update fields, because that is what the Backer
 * is owed either way.
 *
 * The Backer-visible notice is a §18 update carrying the prior/revised pairing
 * 14c already built, so a delivery change appears in the same thread as every
 * other update rather than in a channel of its own.
 */
export async function applyDeliveryRevision(
  deps: FulfillmentDeps,
  input: DeliveryChangeFields & {
    campaignId: string;
    commitmentText: string;
    /** Required on the approval path; ignored on the notice path. */
    changeRequestId?: string | null;
    actor: string;
    now?: Date;
  },
): Promise<ApplyRevisionOutcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const path = deliveryChangePathFor({
    campaignType: facts.campaignType,
    remainingPaymentReleased: facts.remainingPaymentReleased,
  });

  const commitments = await listDeliveryCommitments(deps.db, input.campaignId);
  const original = commitments.find((c) => c.sequence === 1);
  if (!original) return { status: 'no_original_commitment' };

  // The commitment this call is FILING — on the approval path
  // `decideDeliveryChange` already wrote it, so it is already the highest
  // sequence and must not be mistaken for the prior value. "Previous date" is
  // the last commitment the Backers were actually told about; taking
  // `commitments[last]` blindly would show the revised date as its own
  // predecessor (§22.6's pairing renders both, so the two must differ).
  const filed = input.changeRequestId
    ? (commitments.find((c) => c.changeRequestId === input.changeRequestId) ?? null)
    : null;
  const current =
    commitments
      .filter((c) => (filed ? c.sequence < filed.sequence : true))
      .at(-1) ?? original;

  const missing = missingMaterialUpdateFields({
    previous_date: current.deliveryMonth,
    revised_date: input.proposedDeliveryMonth,
    reason: input.reason,
    unchanged_obligations: input.unchangedObligations,
    next_update_date: input.nextUpdateDate,
    support_refund_route: input.supportRefundRoute,
  });
  if (missing.length > 0) return { status: 'missing_fields', fields: missing };

  if (path === 'admin_preapproval') {
    if (!input.changeRequestId) return { status: 'admin_approval_required', path };
    const [request] = await deps.db
      .select({ status: deliveryChangeRequests.status, campaignId: deliveryChangeRequests.campaignId })
      .from(deliveryChangeRequests)
      .where(eq(deliveryChangeRequests.id, input.changeRequestId))
      .limit(1);
    if (!request || request.campaignId !== input.campaignId || request.status !== 'approved') {
      return { status: 'approval_not_granted' };
    }
  }

  const now = input.now ?? new Date();

  return deps.db.transaction(async (tx) => {
    // On the approval path `decideDeliveryChange` already wrote the commitment
    // when it approved the request, so this reuses it rather than writing a
    // second row for one change; on the notice path this is where it is written.
    let commitmentId: string;
    const [alreadyFiled] = input.changeRequestId
      ? await tx
          .select({ id: deliveryCommitments.id, updateId: deliveryCommitments.updateId })
          .from(deliveryCommitments)
          .where(
            and(
              eq(deliveryCommitments.campaignId, input.campaignId),
              eq(deliveryCommitments.changeRequestId, input.changeRequestId),
            ),
          )
          .orderBy(desc(deliveryCommitments.sequence))
          .limit(1)
      : [];

    if (alreadyFiled && alreadyFiled.updateId === null) {
      commitmentId = alreadyFiled.id;
    } else {
      const [{ maxSequence }] = await tx
        .select({ maxSequence: sql<number>`coalesce(max(${deliveryCommitments.sequence}), 0)` })
        .from(deliveryCommitments)
        .where(eq(deliveryCommitments.campaignId, input.campaignId));
      const [created] = await tx
        .insert(deliveryCommitments)
        .values({
          campaignId: input.campaignId,
          sequence: Number(maxSequence) + 1,
          deliveryMonth: monthStart(input.proposedDeliveryMonth),
          deliveryDate: input.proposedDeliveryDate ?? null,
          commitmentText: input.commitmentText,
          reason: input.reason,
          path,
          changeRequestId: input.changeRequestId ?? null,
          recordedBy: input.actor,
        })
        .returning({ id: deliveryCommitments.id });
      commitmentId = created!.id;
    }

    // §22.6's material update — the prior/revised pairing 14c built, with the
    // four other required fields in the body. `is_material_delivery_change`
    // makes the public page render both commitments side by side.
    const body = [
      `Reason: ${input.reason}`,
      `What is unchanged: ${input.unchangedObligations}`,
      `Next update: ${input.nextUpdateDate}`,
      `Support and refunds: ${input.supportRefundRoute}`,
    ].join('\n\n');

    const [update] = await tx
      .insert(campaignUpdates)
      .values({
        campaignId: input.campaignId,
        author: input.actor,
        audience: 'general_public',
        title: 'Updated delivery timeline',
        body,
        publishedAt: now,
        isMaterialDeliveryChange: true,
        priorCommitment: current.commitmentText,
        revisedCommitment: input.commitmentText,
      })
      .returning({ id: campaignUpdates.id });

    await tx
      .update(deliveryCommitments)
      .set({ updateId: update!.id, notifiedBackersAt: now })
      .where(eq(deliveryCommitments.id, commitmentId));

    await deps.audit(
      {
        action: 'fulfillment.delivery_date_revised',
        targetType: 'campaign',
        targetId: input.campaignId,
        actorId: input.actor,
        internalReason: `§22.6 (${path}): delivery date revised; the original commitment is preserved as sequence 1.`,
        customerExplanation: input.reason,
        priorValue: { deliveryMonth: current.deliveryMonth, commitmentText: current.commitmentText },
        newValue: {
          deliveryMonth: monthStart(input.proposedDeliveryMonth),
          commitmentText: input.commitmentText,
          originalDeliveryMonth: original.deliveryMonth,
        },
      });

    return { status: 'revised', commitmentId, updateId: update!.id, path };
  });
}

/* ── §22.5 — the delivery itself ───────────────────────────────────────────── */

export type SetMechanismOutcome =
  | { status: 'saved' }
  | { status: 'campaign_not_found' }
  | { status: 'unknown_mechanism' }
  | { status: 'already_delivered' };

export async function setDeliveryMechanism(
  deps: FulfillmentDeps,
  input: {
    campaignId: string;
    mechanism: string;
    accessInstructions: string;
    actor: string;
  },
): Promise<SetMechanismOutcome> {
  if (!DELIVERY_MECHANISMS.includes(input.mechanism as DeliveryMechanism)) {
    return { status: 'unknown_mechanism' };
  }
  if (input.accessInstructions.trim().length === 0) return { status: 'unknown_mechanism' };

  const [campaign] = await deps.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { status: 'campaign_not_found' };

  const existing = await readFulfillmentRow(deps.db, input.campaignId);
  if (existing?.deliveredAt) return { status: 'already_delivered' };

  if (existing) {
    await deps.db
      .update(campaignFulfillment)
      .set({
        mechanism: input.mechanism,
        accessInstructions: input.accessInstructions,
        updatedAt: new Date(),
        updatedBy: input.actor,
      })
      .where(eq(campaignFulfillment.campaignId, input.campaignId));
  } else {
    await deps.db.insert(campaignFulfillment).values({
      campaignId: input.campaignId,
      mechanism: input.mechanism,
      accessInstructions: input.accessInstructions,
      updatedBy: input.actor,
    });
  }

  await deps.audit({
    action: 'fulfillment.mechanism_set',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason: '§22.5: the promised digital fulfillment mechanism and its access instructions.',
    newValue: { mechanism: input.mechanism },
  });

  return { status: 'saved' };
}

export async function readFulfillmentRow(db: Database, campaignId: string) {
  const [row] = await db
    .select()
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

export type RecordCloseConfirmationOutcome =
  | { status: 'recorded'; withinWindow: boolean }
  | { status: 'campaign_not_found' }
  | { status: 'update_not_found' }
  | { status: 'already_recorded' };

/**
 * §22.5's first obligation. The Founder points at an update they published;
 * whether it landed inside the 48 hours is DERIVED from `campaign_close_at`
 * and the update's own `published_at`, never asserted — a late confirmation is
 * recorded as late rather than refused, because refusing it would leave the
 * Backers with no confirmation at all.
 */
export async function recordCloseConfirmation(
  deps: FulfillmentDeps,
  input: { campaignId: string; updateId: string; actor: string; now?: Date },
): Promise<RecordCloseConfirmationOutcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const [update] = await deps.db
    .select({ id: campaignUpdates.id, publishedAt: campaignUpdates.publishedAt })
    .from(campaignUpdates)
    .where(and(eq(campaignUpdates.id, input.updateId), eq(campaignUpdates.campaignId, input.campaignId)))
    .limit(1);
  if (!update) return { status: 'update_not_found' };

  const existing = await readFulfillmentRow(deps.db, input.campaignId);
  if (existing?.closeConfirmationSentAt) return { status: 'already_recorded' };

  if (existing) {
    await deps.db
      .update(campaignFulfillment)
      .set({
        closeConfirmationUpdateId: update.id,
        closeConfirmationSentAt: update.publishedAt,
        updatedAt: new Date(),
        updatedBy: input.actor,
      })
      .where(eq(campaignFulfillment.campaignId, input.campaignId));
  } else {
    await deps.db.insert(campaignFulfillment).values({
      campaignId: input.campaignId,
      closeConfirmationUpdateId: update.id,
      closeConfirmationSentAt: update.publishedAt,
      updatedBy: input.actor,
    });
  }

  const state = closeConfirmationState({
    closeAt: facts.closeAt,
    anyCaptured: facts.anyCaptured,
    sentAt: update.publishedAt,
    now: input.now ?? new Date(),
  });
  const withinWindow =
    state.dueAt !== null ? update.publishedAt.getTime() <= state.dueAt.getTime() : true;

  await deps.audit({
    action: 'fulfillment.close_confirmation_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason: `§22.5: campaign-close confirmation${withinWindow ? '' : ' (published after the 48-hour window)'}.`,
    newValue: { updateId: update.id, publishedAt: update.publishedAt.toISOString(), withinWindow },
  });

  return { status: 'recorded', withinWindow };
}

export type RecordDeliveryOutcome =
  | { status: 'delivered'; notified: number; campaignMovedTo: string | null }
  | { status: 'campaign_not_found' }
  | { status: 'mechanism_not_set' }
  | { status: 'no_original_commitment' }
  | { status: 'already_delivered'; notified: number };

/**
 * §22.5's third obligation: access is granted, and every charged Backer is told.
 *
 * The three idempotency mechanisms: the `campaign_delivered:<id>` domain key
 * claimed first so everything shares its fate, the conditional UPDATE that only
 * stamps `delivered_at` while it is NULL, and `notification_deliveries` per
 * reservation. A re-run notifies nobody twice.
 *
 * §23.1's `fulfilled` is entered here — "Delivery obligations completed" — and
 * is deliberately NOT `closed_resolved`: the money reconciliation is §22.11's
 * and Phase 21b's, and collapsing the two would say the product shipped because
 * the books balanced.
 */
export async function recordDelivery(
  deps: FulfillmentDeps,
  input: { campaignId: string; actor: string; now?: Date },
): Promise<RecordDeliveryOutcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const row = await readFulfillmentRow(deps.db, input.campaignId);
  if (!row?.mechanism || !row.accessInstructions) return { status: 'mechanism_not_set' };

  const commitments = await listDeliveryCommitments(deps.db, input.campaignId);
  const original = commitments.find((c) => c.sequence === 1);
  if (!original) return { status: 'no_original_commitment' };

  const now = input.now ?? new Date();
  const alreadyDelivered = row.deliveredAt !== null;

  if (!alreadyDelivered) {
    const stamped = await deps.db
      .update(campaignFulfillment)
      .set({
        deliveredAt: now,
        deliveredBy: input.actor,
        fulfilledAt: now,
        updatedAt: now,
        updatedBy: input.actor,
      })
      .where(
        and(
          eq(campaignFulfillment.campaignId, input.campaignId),
          sql`${campaignFulfillment.deliveredAt} IS NULL`,
        ),
      )
      .returning({ id: campaignFulfillment.id });

    if (stamped.length === 1) {
      await deps.db
        .update(founderOperationalShares)
        .set({ deliveryStatus: 'delivered' })
        .where(
          and(
            eq(founderOperationalShares.campaignId, input.campaignId),
            eq(founderOperationalShares.fulfillmentState, 'active'),
          ),
        );

      await deps.audit({
        action: 'fulfillment.delivery_recorded',
        targetType: 'campaign',
        targetId: input.campaignId,
        actorId: input.actor,
        internalReason: '§22.5: access granted through the promised mechanism.',
        newValue: { mechanism: row.mechanism, deliveredAt: now.toISOString() },
      });
    }
  }

  // §22.5's Backer delivery notice — §33.10.1. Deduped per reservation.
  const notified = await notifyDelivery(deps, {
    campaignId: input.campaignId,
    mechanism: row.mechanism as DeliveryMechanism,
    accessInstructions: row.accessInstructions,
    originalCommitment: original.commitmentText,
    now,
  });

  await deps.db
    .update(campaignFulfillment)
    .set({ deliveryNotifiedAt: now, updatedAt: now, updatedBy: input.actor })
    .where(
      and(
        eq(campaignFulfillment.campaignId, input.campaignId),
        sql`${campaignFulfillment.deliveryNotifiedAt} IS NULL`,
      ),
    );

  if (alreadyDelivered) return { status: 'already_delivered', notified };

  const movedTo = await enterFulfilled(deps, input.campaignId, input.actor, now);
  return { status: 'delivered', notified, campaignMovedTo: movedTo };
}

/**
 * §23.1 `fulfilled`. Only from the states whose exit rule names fulfillment;
 * a conditional UPDATE, so a campaign already resolved or enforced is left
 * alone rather than dragged backwards.
 */
async function enterFulfilled(
  deps: FulfillmentDeps,
  campaignId: string,
  actor: string,
  now: Date,
): Promise<string | null> {
  const FROM = [
    'single_payment_released',
    'day_14_review',
    'remaining_payment_released',
  ] as const;

  return deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: sql<string>`${campaigns.status}::text` })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!current || !FROM.includes(current.status as (typeof FROM)[number])) return null;

    const moved = await tx
      .update(campaigns)
      .set({ status: 'fulfilled', updatedAt: now })
      .where(and(eq(campaigns.id, campaignId), sql`${campaigns.status}::text = ${current.status}`))
      .returning({ id: campaigns.id });
    if (moved.length !== 1) return null;

    await tx.insert(campaignStatusHistory).values({
      campaignId,
      fromStatus: current.status as never,
      toStatus: 'fulfilled',
      actor,
    });

    // §23.3's `fulfillment_active` flag is a separate row, not a status value —
    // and it is what keeps fulfillment trackable independently of §22.11.
    await tx.insert(campaignPaymentFlags).values({
      campaignId,
      flag: 'fulfillment_active',
      actor,
      evidence: { deliveredAt: now.toISOString(), specRef: '§22.5, §23.3' },
    });

    return 'fulfilled';
  });
}

/* ── The one §22.5 status resolver every surface renders ───────────────────── */

export interface ObligationStatus {
  key: string;
  label: string;
  evidence: string;
  state: ObligationState;
  dueAt: string | null;
  detail: string;
}

export interface FulfillmentStatusView {
  campaignId: string;
  campaignType: CampaignType;
  mechanism: DeliveryMechanism | null;
  mechanismLabel: string | null;
  accessInstructions: string | null;
  deliveredAt: string | null;
  deliveryNotifiedAt: string | null;
  fulfilledAt: string | null;
  closeAt: string | null;
  chargedAt: string | null;
  obligations: ObligationStatus[];
  cadence: {
    state: ObligationState;
    nextDueAt: string | null;
    daysSinceLastCommunication: number | null;
    silentDays: number;
  };
  commitments: {
    sequence: number;
    deliveryMonth: string;
    deliveryDate: string | null;
    commitmentText: string;
    reason: string | null;
    path: string | null;
    notifiedBackersAt: string | null;
    isOriginal: boolean;
  }[];
  /** Which §22.6 path a change would take right now — derived, never chosen. */
  changePath: DeliveryChangePath;
  pendingChangeRequest: { id: string; reviewDueAt: string; proposedDeliveryMonth: string } | null;
}

/**
 * The ONE place §22.5's obligation status is composed. The Founder surface, the
 * Admin fulfillment panel, and the Day 14 checklist all render its output, so
 * the 30-day cadence cannot say one thing on one screen and another elsewhere
 * (19b's "one source, many renderers", applied to obligations).
 */
export async function readFulfillmentStatus(
  db: Database,
  campaignId: string,
  now: Date = new Date(),
): Promise<FulfillmentStatusView | null> {
  const facts = await loadFulfillmentFacts(db, campaignId);
  if (!facts) return null;

  const row = await readFulfillmentRow(db, campaignId);
  const commitments = await listDeliveryCommitments(db, campaignId);

  const [lastUpdate] = await db
    .select({ publishedAt: campaignUpdates.publishedAt })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt))
    .limit(1);

  const close = closeConfirmationState({
    closeAt: facts.closeAt,
    anyCaptured: facts.anyCaptured,
    sentAt: row?.closeConfirmationSentAt ?? null,
    now,
  });

  const cadence = evaluateUpdateCadence({
    chargedAt: facts.chargedAt,
    lastUpdateAt: lastUpdate?.publishedAt ?? null,
    deliveredAt: row?.deliveredAt ?? null,
    now,
  });

  const obligations: ObligationStatus[] = FOUNDER_FULFILLMENT_OBLIGATIONS.map((o) => {
    switch (o.key) {
      case 'close_confirmation':
        return {
          ...o,
          state: close.state,
          dueAt: close.dueAt?.toISOString() ?? null,
          detail:
            close.state === 'met'
              ? `Confirmed ${row!.closeConfirmationSentAt!.toISOString().slice(0, 10)}.`
              : close.state === 'not_applicable'
                ? 'No charge was captured, so there is no close confirmation to send.'
                : `Due within ${CLOSE_CONFIRMATION_WINDOW_HOURS} hours of close.`,
        };
      case 'update_cadence':
        return {
          ...o,
          state: cadence.state,
          dueAt: cadence.nextDueAt?.toISOString() ?? null,
          detail:
            cadence.state === 'not_applicable'
              ? 'The cadence starts at the charge.'
              : cadence.state === 'met'
                ? 'Delivery is recorded, so the update cadence has ended.'
                : `${cadence.silentDays} day(s) since your last update.`,
        };
      case 'delivery_notification':
        return {
          ...o,
          state: row?.deliveredAt ? 'met' : facts.anyCaptured ? 'due' : 'not_applicable',
          dueAt: null,
          detail: row?.deliveredAt
            ? `Delivered ${row.deliveredAt.toISOString().slice(0, 10)}.`
            : row?.mechanism
              ? 'Ready to deliver — record delivery when access is granted.'
              : 'Set the delivery mechanism and access instructions first.',
        };
      default:
        return {
          ...o,
          state: commitments.length > 0 ? 'met' : 'due',
          dueAt: null,
          detail:
            commitments.length === 0
              ? 'The original delivery commitment has not been recorded yet.'
              : commitments.length === 1
                ? 'Original commitment recorded. A revision is added, never written over it.'
                : `Original preserved; ${commitments.length - 1} revision(s) recorded.`,
        };
    }
  });

  const [pending] = await db
    .select({
      id: deliveryChangeRequests.id,
      reviewDueAt: deliveryChangeRequests.reviewDueAt,
      proposedDeliveryMonth: deliveryChangeRequests.proposedDeliveryMonth,
    })
    .from(deliveryChangeRequests)
    .where(
      and(
        eq(deliveryChangeRequests.campaignId, campaignId),
        eq(deliveryChangeRequests.status, 'pending'),
      ),
    )
    .limit(1);

  const mechanism = (row?.mechanism ?? null) as DeliveryMechanism | null;

  return {
    campaignId,
    campaignType: facts.campaignType,
    mechanism,
    mechanismLabel: mechanism ? DELIVERY_MECHANISM_LABELS[mechanism] : null,
    accessInstructions: row?.accessInstructions ?? null,
    deliveredAt: row?.deliveredAt?.toISOString() ?? null,
    deliveryNotifiedAt: row?.deliveryNotifiedAt?.toISOString() ?? null,
    fulfilledAt: row?.fulfilledAt?.toISOString() ?? null,
    closeAt: facts.closeAt?.toISOString() ?? null,
    chargedAt: facts.chargedAt?.toISOString() ?? null,
    obligations,
    cadence: {
      state: cadence.state,
      nextDueAt: cadence.nextDueAt?.toISOString() ?? null,
      daysSinceLastCommunication: cadence.daysSinceLastCommunication,
      silentDays: cadence.silentDays,
    },
    commitments: commitments.map((c) => ({
      sequence: c.sequence,
      deliveryMonth: c.deliveryMonth,
      deliveryDate: c.deliveryDate,
      commitmentText: c.commitmentText,
      reason: c.reason,
      path: c.path,
      notifiedBackersAt: c.notifiedBackersAt?.toISOString() ?? null,
      isOriginal: c.sequence === 1,
    })),
    changePath: deliveryChangePathFor({
      campaignType: facts.campaignType,
      remainingPaymentReleased: facts.remainingPaymentReleased,
    }),
    pendingChangeRequest: pending
      ? {
          id: pending.id,
          reviewDueAt: pending.reviewDueAt.toISOString(),
          proposedDeliveryMonth: pending.proposedDeliveryMonth,
        }
      : null,
  };
}
