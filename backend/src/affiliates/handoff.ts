/**
 * The Affiliate handoff at `founder_signup_complete` — Spec §10, §31.5, §33.1.9.
 *
 * §10, in full:
 *
 *   For every eligible authenticated Affiliate already recruited and associated
 *   with the campaign:
 *     - The named campaign appears automatically in `preparing` state exactly once.
 *     - A transactional notification has one action: `Review campaign`.
 *     - The Affiliate may read the complete currently available
 *       Founder/problem/solution/competition information and the single Campaign kit.
 *     - This is a recorded pilot-only trusted-cohort exception…
 *     - The Affiliate cannot accept, decline, propose compensation, activate a
 *       link, or begin work until listing-fee payment…
 *
 * Phase 07 emitted the event and stopped. This consumes it.
 *
 * ── "Exactly once" is three mechanisms, because they fail differently ───────
 * §33.1.9 counts it and §10 says it twice ("exactly once", and Admin sees "No
 * duplicate visibility event or email may occur after retries").
 *
 *   1. `idempotency_keys` on `affiliate_preparing_revealed:<associationId>` —
 *      inserted inside the per-association transaction, so a second attempt
 *      hits the unique index and rolls back everything after it.
 *   2. The conditional status UPDATE `signed_up_waiting_for_founder → preparing`
 *      — matches zero rows the second time, which settles two concurrent runs
 *      of the batch against one another.
 *   3. `notification_deliveries` on (event, target, entity) — so even a
 *      duplicate that somehow reached the notifier cannot produce a second email.
 *
 * Any one of them would stop the common case. All three are here because §10
 * names the guarantee twice and §33.7.7's rule — a duplicate event may update
 * audit but never duplicate domain state, money, or a message — applies to this
 * one as much as to a webhook.
 *
 * ── Who is eligible ─────────────────────────────────────────────────────────
 * §10 says "eligible authenticated Affiliate already recruited and associated".
 * That is: an association in `signed_up_waiting_for_founder` — which by
 * construction means the Creator has an account (`signed_up`) and the campaign
 * was not ready (`waiting_for_founder`) — whose kit access has not been revoked.
 *
 * A Creator still at `invited` or `signup_started` has no account, so there is
 * nobody authenticated to reveal anything to; they will see the campaign when
 * they finish signing up, because the surface reads the same state. Revealing
 * to them here would mean writing a `preparing` state for a person who cannot
 * sign in to see it.
 *
 * ── One reveal per association, and one email ───────────────────────────────
 * Each association is its own transaction. One Creator's failure — a revoked
 * kit, a provider refusal — must not roll back another's reveal: they are
 * independent grants of access to independent people, and a batch that was all
 * or nothing would let one bad row hold the whole roster in the dark.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Notifier } from '../notifications/send.js';
import { AFFILIATE_FOUNDER_SIGNUP_COMPLETED } from '../notifications/events.js';
import { renderPreparingAvailable } from '../notifications/templates/affiliate-preparing-available.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignKitAccess } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { transitionAssociation } from './recruitment.js';

/** The domain event §33.1.9 counts, per association. */
export const AFFILIATE_PREPARING_REVEALED = 'affiliate_preparing_revealed' as const;

export function preparingRevealedKey(associationId: string): string {
  return `${AFFILIATE_PREPARING_REVEALED}:${associationId}`;
}

/** §10: the notification carries ONE action, and this is its name. */
export const REVIEW_CAMPAIGN_ACTION = 'Review campaign' as const;

export interface HandoffDeps {
  db: Database;
  notifier: Notifier;
  context: { appBaseUrl: string; supportEmail: string; fromAddress: string };
}

export interface HandoffResult {
  /** Associations moved into `preparing` by this run. */
  revealed: string[];
  /** Already revealed by an earlier run. Not an error — the point of the key. */
  alreadyRevealed: string[];
  /** Eligible, but the reveal or its email failed. Visible to Admin. */
  failed: Array<{ associationId: string; reason: string }>;
}

/**
 * Reveals the preparing campaign to every eligible Creator on it.
 *
 * Safe to call repeatedly: that is what the idempotency key is for, and §10
 * requires it explicitly ("No duplicate visibility event or email may occur
 * after retries"). Called after the Founder claim commits, and callable again
 * by Admin if a run was interrupted.
 */
export async function revealPreparingCampaign(
  { db, notifier, context }: HandoffDeps,
  campaignId: string,
): Promise<HandoffResult> {
  const result: HandoffResult = { revealed: [], alreadyRevealed: [], failed: [] };

  const eligible = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      status: campaignAffiliateAssociations.status,
      revealedAt: campaignAffiliateAssociations.preparingRevealedAt,
      revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
      affiliateUserId: affiliateSignupProfiles.claimedUserId,
      email: affiliateSignupProfiles.email,
      publicHandle: affiliateSignupProfiles.publicHandle,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, campaignId),
        // §10's "eligible authenticated Affiliate already recruited and
        // associated". Anything earlier has no account to authenticate.
        eq(campaignAffiliateAssociations.status, 'signed_up_waiting_for_founder'),
        // §31.5: a revoked association has had the exception withdrawn. It is
        // not eligible for it to be granted again by a retry.
        isNull(campaignAffiliateAssociations.kitAccessRevokedAt),
      ),
    );

  if (eligible.length === 0) return result;

  const product = await readProductName(db, campaignId);

  for (const row of eligible) {
    if (!row.affiliateUserId) {
      // A profile claimed with no user id would be a broken claim, not an
      // eligible Creator. Recorded rather than silently skipped.
      result.failed.push({ associationId: row.associationId, reason: 'no_account' });
      continue;
    }

    try {
      const moved = await db.transaction(async (tx) => {
        // Mechanism 1. First, so everything after it is protected by the same
        // unique index and a duplicate aborts the whole transaction.
        await tx.insert(idempotencyKeys).values({
          key: preparingRevealedKey(row.associationId),
          purpose: AFFILIATE_PREPARING_REVEALED,
          completedAt: new Date(),
          result: { associationId: row.associationId, campaignId },
        });

        // Mechanism 2. Settles two concurrent runs against one another.
        const transitioned = await transitionAssociation(
          row.associationId,
          'signed_up_waiting_for_founder',
          'preparing',
          'system:founder_signup_complete',
          tx,
        );
        if (!transitioned) throw new AlreadyRevealed();

        await tx
          .update(campaignAffiliateAssociations)
          .set({ preparingRevealedAt: new Date(), updatedAt: new Date() })
          .where(eq(campaignAffiliateAssociations.id, row.associationId));

        await tx.insert(auditEvents).values({
          actor: 'system:founder_signup_complete',
          targetType: 'affiliate_association',
          targetId: row.associationId,
          action: AFFILIATE_PREPARING_REVEALED,
          internalReason:
            'Founder signup completed; preparing campaign revealed under the §31.5 pilot pre-view exception — logged, revocable, and granting no work permission',
          customerExplanation: 'A campaign you were recruited for is ready to read.',
          priorValue: { status: 'signed_up_waiting_for_founder' },
          newValue: { status: 'preparing', campaignId, affiliateUserId: row.affiliateUserId },
        });

        return true;
      });

      if (!moved) continue;
    } catch (error) {
      if (error instanceof AlreadyRevealed || isUniqueViolation(error)) {
        result.alreadyRevealed.push(row.associationId);
        continue;
      }
      throw error;
    }

    // The email is sent after the transaction commits, for the reason the
    // signup confirmation documents: a message about access that does not exist
    // is worse than a missing one. Mechanism 3 stops a duplicate here.
    if (row.email) {
      const message = await renderPreparingAvailable({
        recipientName: row.publicHandle,
        productName: product,
        reviewUrl: `${context.appBaseUrl}/creator/campaigns/${row.associationId}`,
        reference: campaignId,
        supportEmail: context.supportEmail,
      });

      const outcome = await notifier.send({
        eventKey: AFFILIATE_FOUNDER_SIGNUP_COMPLETED,
        entityType: 'affiliate_association',
        entityId: row.associationId,
        to: row.email,
        from: context.fromAddress,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      if (outcome.status === 'failed') {
        // The reveal stands — the Creator can still see the campaign when they
        // sign in. Rolling it back to keep the email and the access in step
        // would withdraw the more valuable of the two.
        await db.insert(auditEvents).values({
          actor: 'system:founder_signup_complete',
          targetType: 'affiliate_association',
          targetId: row.associationId,
          action: 'affiliate.preparing_notification_failed',
          internalReason: `provider refused: ${outcome.reason}`,
          customerExplanation: null,
          newValue: { deliveryConfirmed: false },
        });
        result.failed.push({ associationId: row.associationId, reason: 'notification_failed' });
      }
    }

    result.revealed.push(row.associationId);
  }

  return result;
}

class AlreadyRevealed extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

async function readProductName(db: Database, campaignId: string): Promise<string | null> {
  const [row] = await db
    .select({ productName: founderProspects.productName })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignDrafts.campaignId, campaignId))
    .limit(1);
  return row?.productName ?? null;
}

/* ── Revocation (§10, §31.5) ──────────────────────────────────────────────── */

/**
 * Withdraws the pilot pre-view from one association.
 *
 * §10: "Revocation removes it immediately." §31.5 makes revocability one of the
 * four conditions the exception depends on, so this is not an administrative
 * convenience — it is the thing that keeps the exception defensible.
 *
 * The association status is NOT rolled back. §23.4's machine has no edge out of
 * `preparing` except to `formal_decision_open` or `removed`, and inventing one
 * is §1 rule 6. The revocation stamp is what the kit read checks; the status
 * continues to describe the relationship.
 */
export async function revokeKitAccess(
  db: Database,
  input: { associationId: string; actor: string; reason: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!input.reason.trim()) {
    return { ok: false, message: 'Say why access is being revoked. The reason is stored.' };
  }

  const [current] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);

  if (!current) return { ok: false, message: 'That association does not exist.' };
  if (current.revokedAt) {
    return { ok: false, message: 'Access to this campaign kit has already been revoked.' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaignAffiliateAssociations)
      .set({
        kitAccessRevokedAt: new Date(),
        kitAccessRevokedReason: input.reason.trim(),
        kitAccessRevokedBy: input.actor,
        updatedAt: new Date(),
      })
      .where(eq(campaignAffiliateAssociations.id, input.associationId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: input.associationId,
      action: 'affiliate.kit_access_revoked',
      internalReason: input.reason.trim(),
      customerExplanation: null,
      priorValue: { kitAccessRevoked: false },
      newValue: { kitAccessRevoked: true, campaignId: current.campaignId },
    });
  });

  return { ok: true };
}

/* ── Who can see this campaign, for Admin (§10) ───────────────────────────── */

/**
 * §10: Admin sees "the set of Affiliates who received preparing visibility,
 * delivery status of notifications, and any revoked association."
 */
export interface PreparingVisibilityRow {
  associationId: string;
  publicHandle: string | null;
  status: string;
  revealedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  revokedBy: string | null;
  /** Reads of the kit under this association. §31.5's log, summarised. */
  accessCount: number;
  lastAccessAt: Date | null;
}

export async function readPreparingVisibility(
  db: Database,
  campaignId: string,
): Promise<PreparingVisibilityRow[]> {
  const rows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      publicHandle: affiliateSignupProfiles.publicHandle,
      status: campaignAffiliateAssociations.status,
      revealedAt: campaignAffiliateAssociations.preparingRevealedAt,
      revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
      revokedReason: campaignAffiliateAssociations.kitAccessRevokedReason,
      revokedBy: campaignAffiliateAssociations.kitAccessRevokedBy,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const counts = await readAccessCounts(db, campaignId);

  return rows.map((row) => ({
    ...row,
    accessCount: counts.get(row.associationId)?.count ?? 0,
    lastAccessAt: counts.get(row.associationId)?.last ?? null,
  }));
}

async function readAccessCounts(
  db: Database,
  campaignId: string,
): Promise<Map<string, { count: number; last: Date }>> {
  const rows = await db
    .select({
      associationId: campaignKitAccess.associationId,
      occurredAt: campaignKitAccess.occurredAt,
    })
    .from(campaignKitAccess)
    .where(eq(campaignKitAccess.campaignId, campaignId));

  const out = new Map<string, { count: number; last: Date }>();
  for (const row of rows) {
    const existing = out.get(row.associationId);
    if (!existing) {
      out.set(row.associationId, { count: 1, last: row.occurredAt });
    } else {
      existing.count += 1;
      if (row.occurredAt > existing.last) existing.last = row.occurredAt;
    }
  }
  return out;
}
