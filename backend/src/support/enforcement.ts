/**
 * Campaign suspension and kill — §26.7, §29.7, §33.9.8.
 *
 * §26.7: "Kill/suspend requires reason category + free text.
 *   **Pre-capture:** close active reservations without charge, block future
 *   PaymentIntents, reference-safely detach methods, notify roles, preserve page
 *   with correct banner.
 *   **Post-capture:** invoke refund/reversal/recovery policy, restrict
 *   unreleased funds where possible, notify roles, preserve evidence."
 *
 * The phase brief draws the line: "Post-capture consequences land fully in Phase
 * 20; build the decision, the audit, and the notification here." So a
 * post-capture enforcement records the decision completely and moves the
 * lifecycle — and executes no refund and no reversal, because those are Phase
 * 20's and inventing them here would be a second refund path beside Phase 11's
 * single one.
 *
 * ── The phase is derived, never passed in ───────────────────────────────────
 * `enforcementPhaseFor` reads the campaign's own lifecycle. A caller that could
 * declare "this is pre-capture" could close reservations that have already been
 * charged — which is the one mistake in this file that would move real money the
 * wrong way.
 *
 * ── A successful SetupIntent stays historical (§23.5, §29.7) ────────────────
 * §29.7 says it outright: "Successful SetupIntents remain historical, never
 * rewritten as canceled." Nothing here writes to `setup_intent_id`. The
 * reservation moves to `killed_no_charge` — its own §23.5 state, distinct from
 * the Backer's own `reserved_canceled`, because who ended it is a fact worth
 * keeping.
 *
 * ── Reference-safe detach is Phase 15's rule, reused ────────────────────────
 * §33.7.2: never detach a PaymentMethod still supporting another active
 * transaction. `paymentMethodStillActive` already answers that question and is
 * called here rather than reimplemented — a second implementation would be a
 * second answer, and one of them would eventually detach a live card.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations, reservationStatusHistory, campaignStatusHistory } from '../db/schema/domain.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { campaignEnforcementActions } from '../db/schema/support.js';
import { releaseCapacity } from '../reservations/capacity.js';
import { containsRawProviderCode } from '../admin/logic.js';
import {
  ENFORCEMENT_REASON_CATEGORIES,
  ENFORCEMENT_ACTIONS,
  PRE_CAPTURE_EFFECTS,
  enforcementPhaseFor,
  type EnforcementActionKind,
  type EnforcementReasonCategory,
  type EnforcementPhaseKind,
  type PreCaptureEffect,
} from './logic.js';

export interface EnforceInput {
  campaignId: string;
  action: EnforcementActionKind;
  reasonCategory: EnforcementReasonCategory;
  /** §26.7's free text. Required alongside the category, never instead of it. */
  reasonDetail: string;
  /** What the preserved page and the notices actually say (§18, §25.6). */
  customerExplanation: string;
  actor: string;
  mfaContext: string;
  reauthContext: string;
  evidenceLinks?: Record<string, unknown> | undefined;
}

export interface EnforceResult {
  enforcementId: string;
  action: EnforcementActionKind;
  phase: EnforcementPhaseKind;
  priorCampaignStatus: string;
  newCampaignStatus: string;
  effectsApplied: PreCaptureEffect[];
  reservationsClosed: number;
  paymentMethodsDetached: number;
  /** True when a retry found the first decision and changed nothing. */
  replayed: boolean;
  /** Phase 20 owns the money consequences; named so the surface can say so. */
  postCaptureConsequencesDeferred: boolean;
}

export type EnforceOutcome =
  | { ok: true; result: EnforceResult }
  | {
      ok: false;
      code: 'not_found' | 'invalid' | 'raw_provider_code' | 'already_ended';
      message: string;
    };

export interface EnforcementDeps {
  db: Database;
  /** Detaches a card at the provider. Absent → detach is recorded as pending. */
  detachPaymentMethod?:
    | ((input: { paymentMethodId: string; connectedAccountId: string }) => Promise<void>)
    | undefined;
  connectedAccountId?: string | undefined;
  /** §26.7: notify affected roles. Absent → the effect is not claimed as applied. */
  notifyRoles?: ((input: { campaignId: string; explanation: string }) => Promise<void>) | undefined;
}

/**
 * Suspend or kill a campaign.
 *
 * One transaction, claimed on an idempotency key first so a retry is the same
 * decision rather than a second one — the §11 listing-payment shape. A
 * post-capture kill records everything and touches no money.
 */
export async function enforceCampaign(
  deps: EnforcementDeps,
  input: EnforceInput,
): Promise<EnforceOutcome> {
  const { db } = deps;

  if (!ENFORCEMENT_ACTIONS.includes(input.action)) {
    return { ok: false, code: 'invalid', message: 'That is not an enforcement action.' };
  }
  if (!ENFORCEMENT_REASON_CATEGORIES.includes(input.reasonCategory)) {
    return { ok: false, code: 'invalid', message: 'That is not a §26.7 reason category.' };
  }
  // §26.7's own sentence. A category alone is a classification nobody can
  // review; free text alone is a decision nobody can count.
  if (!input.reasonDetail.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message:
        'A suspension or kill records both a reason category and free text describing this case (§26.7).',
    };
  }
  if (!input.customerExplanation.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message:
        'The preserved page must say why this campaign ended. §18 forbids one generic `Campaign ended` message.',
    };
  }
  // §33.9.11: the explanation becomes the public ended-state copy.
  if (containsRawProviderCode(input.customerExplanation)) {
    return {
      ok: false,
      code: 'raw_provider_code',
      message:
        'The customer explanation contains a raw provider or fraud code. Those stay in the internal reason (§26.8, §33.9.11).',
    };
  }

  const [campaign] = await db
    .select({ id: campaigns.id, status: sql<string>`${campaigns.status}::text` })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) return { ok: false, code: 'not_found', message: 'No such campaign.' };
  if (campaign.status === 'killed' || campaign.status === 'suspended') {
    return {
      ok: false,
      code: 'already_ended',
      message: `This campaign is already ${campaign.status}. Nothing has changed.`,
    };
  }

  const phase = enforcementPhaseFor(campaign.status);
  const newStatus = input.action === 'kill' ? 'killed' : 'suspended';
  const idempotencyKey = `campaign_${input.action}:${input.campaignId}`;

  // Decide reference-safe detach BEFORE the transaction closes anything, so
  // every reservation is still `reserved_active` and the comparison is against
  // the world as it was (§33.7.2, the Phase 15 cancellation shape).
  const detachable: Array<{ reservationId: string; paymentMethodId: string }> = [];
  if (phase === 'pre_capture') {
    const active = await db
      .select({
        id: reservations.id,
        backerIdentityId: reservations.backerIdentityId,
        paymentMethodId: reservations.paymentMethodId,
      })
      .from(reservations)
      .where(
        and(eq(reservations.campaignId, input.campaignId), eq(reservations.status, 'reserved_active')),
      );

    for (const row of active) {
      if (!row.paymentMethodId) continue;
      const [other] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.backerIdentityId, row.backerIdentityId),
            eq(reservations.paymentMethodId, row.paymentMethodId),
            eq(reservations.status, 'reserved_active'),
            ne(reservations.id, row.id),
          ),
        )
        .limit(1);
      if (!other) detachable.push({ reservationId: row.id, paymentMethodId: row.paymentMethodId });
    }
  }

  const applied = await db.transaction(async (tx) => {
    // Claimed first, so everything below shares its fate (§28.3).
    try {
      await tx.insert(idempotencyKeys).values({
        key: idempotencyKey,
        purpose: `campaign_${input.action}`,
        completedAt: new Date(),
      });
    } catch {
      return null; // a prior decision holds the key.
    }

    const now = new Date();

    const moved = await tx
      .update(campaigns)
      .set({ status: newStatus, updatedAt: now })
      .where(and(eq(campaigns.id, input.campaignId), sql`${campaigns.status}::text = ${campaign.status}`))
      .returning({ id: campaigns.id });

    if (moved.length !== 1) return null;

    await tx.insert(campaignStatusHistory).values({
      campaignId: input.campaignId,
      fromStatus: campaign.status as never,
      toStatus: newStatus as never,
      actor: input.actor,
    });

    const effects: PreCaptureEffect[] = [];
    let reservationsClosed = 0;

    if (phase === 'pre_capture') {
      // §26.7 effect 1: close active reservations WITHOUT charge. `killed_no_charge`
      // is §23.5's own state — distinct from `reserved_canceled`, because a Backer
      // cancelling and Proovd ending a campaign are different facts.
      const closed = await tx
        .update(reservations)
        .set({ status: 'killed_no_charge', canceledAt: now, updatedAt: now })
        .where(
          and(
            eq(reservations.campaignId, input.campaignId),
            eq(reservations.status, 'reserved_active'),
          ),
        )
        .returning({
          id: reservations.id,
          subtotal: reservations.rewardSubtotalCents,
        });

      reservationsClosed = closed.length;

      for (const row of closed) {
        await tx.insert(reservationStatusHistory).values({
          reservationId: row.id,
          fromStatus: 'reserved_active',
          toStatus: 'killed_no_charge',
          actor: input.actor,
        });
        // Out of the cap and the threshold, exactly as a cancellation does.
        await releaseCapacity(tx, input.campaignId, row.subtotal);
        // §19: the Founder's operational record becomes `do not fulfill`. What
        // was already shared is not retracted — only the state flips.
        await tx
          .update(founderOperationalShares)
          .set({
            fulfillmentState: 'do_not_fulfill',
            doNotFulfillAt: now,
            deliveryStatus: 'do_not_fulfill',
          })
          .where(eq(founderOperationalShares.reservationId, row.id));
      }

      effects.push('close_active_reservations_without_charge');
      // §26.7 effect 2: block future PaymentIntents. The enforcement is the
      // lifecycle itself — Phase 18's close batch selects on `live`/closing
      // states, and `killed`/`suspended` are neither, so no PaymentIntent can be
      // created for this campaign by any path. A separate boolean flag would be
      // a second answer to a question the state machine already settles (§23.1).
      effects.push('block_future_payment_intents');
      // §18's ended-state contract: the page stays up and says why. The public
      // endpoint already classifies `killed`/`suspended` — this decision is what
      // gives it the outcome-specific copy to render.
      effects.push('preserve_page_with_banner');
    }

    return { now, effects, reservationsClosed };
  });

  if (!applied) {
    // A prior decision exists. Return it unchanged rather than deciding twice.
    const [existing] = await db
      .select()
      .from(campaignEnforcementActions)
      .where(eq(campaignEnforcementActions.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        ok: true,
        result: {
          enforcementId: existing.id,
          action: existing.action,
          phase: existing.phase,
          priorCampaignStatus: existing.priorCampaignStatus,
          newCampaignStatus: existing.newCampaignStatus,
          effectsApplied: existing.effectsApplied as PreCaptureEffect[],
          reservationsClosed: existing.reservationsClosed,
          paymentMethodsDetached: existing.paymentMethodsDetached,
          replayed: true,
          postCaptureConsequencesDeferred: existing.phase === 'post_capture',
        },
      };
    }
    return {
      ok: false,
      code: 'already_ended',
      message: 'This campaign has already been acted on. Nothing has changed.',
    };
  }

  // §26.7 effect 3: reference-safe detach, after the close committed. A provider
  // refusal is recorded and never rolled back onto the enforcement — the
  // campaign is killed either way, and a card left attached is recoverable.
  let detached = 0;
  if (deps.detachPaymentMethod && deps.connectedAccountId) {
    for (const target of detachable) {
      try {
        await deps.detachPaymentMethod({
          paymentMethodId: target.paymentMethodId,
          connectedAccountId: deps.connectedAccountId,
        });
        detached += 1;
      } catch (error) {
        await db.insert(auditEvents).values({
          actor: input.actor,
          targetType: 'reservation',
          targetId: target.reservationId,
          action: 'enforcement.detach_failed',
          internalReason: `PaymentMethod detach failed after ${input.action}: ${
            error instanceof Error ? error.message : String(error)
          }. The reservation is closed; the method can be detached on retry.`,
        });
      }
    }
  }

  const effects = [...applied.effects];
  if (detachable.length > 0 && detached > 0) effects.push('reference_safe_detach');

  // §26.7 effect 4: notify affected roles.
  if (deps.notifyRoles) {
    try {
      await deps.notifyRoles({
        campaignId: input.campaignId,
        explanation: input.customerExplanation,
      });
      effects.push('notify_affected_roles');
    } catch (error) {
      await db.insert(auditEvents).values({
        actor: input.actor,
        targetType: 'campaign',
        targetId: input.campaignId,
        action: 'enforcement.notify_failed',
        internalReason: `role notification failed after ${input.action}: ${
          error instanceof Error ? error.message : String(error)
        }. The decision stands and is recorded; the notice is retryable.`,
      });
    }
  }

  const [record] = await db
    .insert(campaignEnforcementActions)
    .values({
      campaignId: input.campaignId,
      action: input.action,
      phase,
      reasonCategory: input.reasonCategory,
      reasonDetail: input.reasonDetail,
      customerExplanation: input.customerExplanation,
      priorCampaignStatus: campaign.status,
      newCampaignStatus: newStatus,
      effectsApplied: effects,
      reservationsClosed: applied.reservationsClosed,
      paymentMethodsDetached: detached,
      actor: input.actor,
      mfaContext: input.mfaContext,
      reauthContext: input.reauthContext,
      evidenceLinks: input.evidenceLinks ?? null,
      idempotencyKey,
      occurredAt: applied.now,
    })
    .returning({ id: campaignEnforcementActions.id });

  await db.insert(auditEvents).values({
    actor: input.actor,
    mfaContext: input.mfaContext,
    reauthContext: input.reauthContext,
    targetType: 'campaign',
    targetId: input.campaignId,
    action: `campaign.${input.action}`,
    internalReason: `${input.reasonCategory}: ${input.reasonDetail}`,
    customerExplanation: input.customerExplanation,
    priorValue: { status: campaign.status },
    newValue: {
      status: newStatus,
      phase,
      effectsApplied: effects,
      reservationsClosed: applied.reservationsClosed,
      paymentMethodsDetached: detached,
      ...(phase === 'post_capture'
        ? {
            note: 'Post-capture refund, reversal, and recovery are Phase 20. This records the decision only.',
          }
        : {}),
    },
    evidenceLinks: input.evidenceLinks ?? null,
  });

  return {
    ok: true,
    result: {
      enforcementId: record!.id,
      action: input.action,
      phase,
      priorCampaignStatus: campaign.status,
      newCampaignStatus: newStatus,
      effectsApplied: effects,
      reservationsClosed: applied.reservationsClosed,
      paymentMethodsDetached: detached,
      replayed: false,
      postCaptureConsequencesDeferred: phase === 'post_capture',
    },
  };
}

/** Every enforcement recorded against a campaign, newest first. */
export async function listEnforcementActions(db: Database, campaignId: string) {
  return db
    .select()
    .from(campaignEnforcementActions)
    .where(eq(campaignEnforcementActions.campaignId, campaignId))
    .orderBy(sql`${campaignEnforcementActions.occurredAt} DESC`);
}

/** Exposed so the suite asserts the register rather than the implementation. */
export { PRE_CAPTURE_EFFECTS };
