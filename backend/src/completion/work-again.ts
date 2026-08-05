/**
 * §22.9's work-again request — Spec §22.9, §30, §33.10.7, §33.10.8 (Phase 21b).
 *
 * ── The whole design is what this does NOT do ───────────────────────────────
 * §22.9: "Acceptance creates no campaign and bypasses no active-campaign
 * limit, three-month cooldown, or Admin readiness approval." A Founder asking
 * a Creator to work again is at their most motivated to read an acceptance as
 * permission, so the record is built so there is nothing to misread: the table
 * has no campaign to create, no terms, no percentage, and no amount, and this
 * module imports nothing that could create a campaign or move a gate. The
 * suite asserts the absence in `information_schema` and asserts that accepting
 * changes no campaign row, no readiness record, and no cooldown.
 *
 * ── Eligibility is the completion status, enforced twice ────────────────────
 * §33.10.7: "Only eligible completed Creator can receive a post-end
 * work-again request." The service refuses by name, and a 0036 trigger refuses
 * regardless — a support script writing the row directly gets the same answer.
 *
 * ── It routes through Proovd, and there is no message channel ───────────────
 * §22.9: "Routes through Proovd; no direct messaging", and §30 defers direct
 * Founder–Creator messaging permanently for the MVP. The request carries ONE
 * message, written once at request time and immutable afterwards, and the
 * response carries one note. There is no thread, no reply route, and no way to
 * add a second message to an existing request — which is what keeps this from
 * becoming the channel §30 refuses.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { creatorCompletionStatuses, workAgainRequests } from '../db/schema/completion.js';
import type { AuditWriter } from '../auth/audit.js';

export interface WorkAgainDeps {
  db: Database;
  audit: AuditWriter;
}

export type WorkAgainRefusal =
  | 'not_found'
  | 'not_completed'
  | 'campaign_not_ended'
  | 'already_open'
  | 'not_open'
  | 'message_required';

export type RequestOutcome =
  | { ok: true; requestId: string }
  | { ok: false; code: WorkAgainRefusal; message: string };

/** §22.9: "After campaign end". Anything still running has no completed work. */
const ENDED_STATUSES = [
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
] as const;

/**
 * A Founder asks a Creator to work together again.
 *
 * Creates a request and nothing else. The completion status it cites is
 * recorded on the row, so a later correction changes what may be asked next
 * without rewriting what was asked (§22.9).
 */
export async function requestWorkAgain(
  deps: WorkAgainDeps,
  input: {
    associationId: string;
    founderUserId: string;
    message: string;
  },
): Promise<RequestOutcome> {
  const { db } = deps;

  if (!input.message.trim()) {
    return {
      ok: false,
      code: 'message_required',
      message: 'Say what you would like to work on. A blank request is not one.',
    };
  }

  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      campaignStatus: campaigns.status,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) {
    return { ok: false, code: 'not_found', message: 'No such Creator on any campaign of yours.' };
  }

  if (!(ENDED_STATUSES as readonly string[]).includes(association.campaignStatus)) {
    return {
      ok: false,
      code: 'campaign_not_ended',
      message: '§22.9 opens this after the campaign ends. This one is still running.',
    };
  }

  const [completion] = await db
    .select({ id: creatorCompletionStatuses.id, status: creatorCompletionStatuses.status })
    .from(creatorCompletionStatuses)
    .where(
      and(
        eq(creatorCompletionStatuses.associationId, input.associationId),
        isNull(creatorCompletionStatuses.supersededAt),
      ),
    )
    .limit(1);

  if (!completion || completion.status !== 'successfully_completed') {
    // §33.10.7. Deliberately the same answer for "not completed" and "not
    // decided yet": both mean the Creator is not eligible, and distinguishing
    // them would tell a Founder that an Admin decision is pending on someone
    // else's record.
    return {
      ok: false,
      code: 'not_completed',
      message:
        'You can only ask a Creator who is marked successfully completed on this campaign (§22.9).',
    };
  }

  const [open] = await db
    .select({ id: workAgainRequests.id })
    .from(workAgainRequests)
    .where(
      and(
        eq(workAgainRequests.originalCampaignId, association.campaignId),
        eq(workAgainRequests.associationId, input.associationId),
        eq(workAgainRequests.status, 'requested'),
      ),
    )
    .limit(1);
  if (open) {
    return {
      ok: false,
      code: 'already_open',
      message: 'You already have an unanswered request with this Creator.',
    };
  }

  const [row] = await db
    .insert(workAgainRequests)
    .values({
      originalCampaignId: association.campaignId,
      associationId: input.associationId,
      founderUserId: input.founderUserId,
      message: input.message.trim(),
      completionStatusId: completion.id,
    })
    .returning({ id: workAgainRequests.id });

  await deps.audit({
    action: 'work_again.requested',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.9 work-again request against completion status ${completion.id}`,
    newValue: { requestId: row!.id },
    actorId: input.founderUserId,
  });

  return { ok: true, requestId: row!.id };
}

export type RespondOutcome =
  | { ok: true; status: 'accepted' | 'declined' }
  | { ok: false; code: WorkAgainRefusal; message: string };

/**
 * The Creator answers. Accepting creates nothing (§33.10.8).
 *
 * There is deliberately no branch on `accept` that does anything beyond
 * writing the answer — no campaign insert, no readiness write, no cooldown
 * adjustment, no association change. The absence is the enforcement, and the
 * suite compares the campaign row, the readiness record, and the association
 * byte-for-byte before and after.
 */
export async function respondToWorkAgain(
  deps: WorkAgainDeps,
  input: {
    requestId: string;
    accept: boolean;
    responseNote?: string | undefined;
    actor: string;
  },
): Promise<RespondOutcome> {
  const status = input.accept ? 'accepted' : 'declined';

  const moved = await deps.db
    .update(workAgainRequests)
    .set({
      status,
      respondedAt: new Date(),
      responseNote: input.responseNote?.trim() || null,
    })
    .where(and(eq(workAgainRequests.id, input.requestId), eq(workAgainRequests.status, 'requested')))
    .returning({ id: workAgainRequests.id });

  if (moved.length !== 1) {
    return {
      ok: false,
      code: 'not_open',
      message: 'That request is not open. It may already have been answered or withdrawn.',
    };
  }

  await deps.audit({
    action: `work_again.${status}`,
    targetType: 'work_again_request',
    targetId: input.requestId,
    // §22.9: "without penalty". Recorded so the record itself says so, and a
    // later reader cannot mistake a decline for a mark against the Creator.
    internalReason: `§22.9 ${status}. A decline carries no penalty and does not affect completion status.`,
    actorId: input.actor,
  });

  return { ok: true, status };
}

/** The Founder retracts an unanswered request. Not a Creator-visible outcome. */
export async function withdrawWorkAgain(
  deps: WorkAgainDeps,
  input: { requestId: string; actor: string },
): Promise<RespondOutcome | { ok: true; status: 'withdrawn' }> {
  const moved = await deps.db
    .update(workAgainRequests)
    .set({ status: 'withdrawn', respondedAt: new Date() })
    .where(and(eq(workAgainRequests.id, input.requestId), eq(workAgainRequests.status, 'requested')))
    .returning({ id: workAgainRequests.id });

  if (moved.length !== 1) {
    return { ok: false, code: 'not_open', message: 'That request is not open.' };
  }

  await deps.audit({
    action: 'work_again.withdrawn',
    targetType: 'work_again_request',
    targetId: input.requestId,
    internalReason: '§22.9 request withdrawn by the Founder before an answer.',
    actorId: input.actor,
  });

  return { ok: true, status: 'withdrawn' };
}

/** Every request a Creator has received, newest first. */
export async function listWorkAgainForCreator(db: Database, associationId: string) {
  return db
    .select()
    .from(workAgainRequests)
    .where(eq(workAgainRequests.associationId, associationId))
    .orderBy(desc(workAgainRequests.requestedAt));
}

/** Every request a Founder has sent on one campaign. */
export async function listWorkAgainForCampaign(db: Database, campaignId: string) {
  return db
    .select()
    .from(workAgainRequests)
    .where(eq(workAgainRequests.originalCampaignId, campaignId))
    .orderBy(desc(workAgainRequests.requestedAt));
}
