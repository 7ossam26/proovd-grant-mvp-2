/**
 * The Founder→Creator meeting request — Founder Dashboard Session C,
 * deviation 1. Migration 0056.
 *
 * A RECORDED DEVIATION from §1 rule 6, by explicit product direction. The full
 * statement is in `db/schema/meetings.ts`; the short version is that §30 defers
 * a Founder–Creator meeting scheduler and direct Founder–Affiliate messaging,
 * §11 says the Founder cannot contact the Affiliate directly, and this is built
 * anyway on §22.9's shape — one message, one answer, routed through Proovd.
 *
 * ── Three things this module cannot do, and why each absence is the point ───
 *  1. It cannot book time. No parameter, column, or route accepts an instant,
 *     a duration, a platform, or a slot. §12's Cal.com booking is the one
 *     scheduler (tech-stack §12).
 *  2. It cannot send a second message. `requestMeeting` inserts; nothing
 *     updates `message`, and the 0056 trigger refuses it anyway.
 *  3. It cannot move terms. Nothing here reads or writes `proposal_versions`,
 *     `association_compensation_agreements`, `creator_bonuses`, or
 *     `campaign_affiliate_associations.status`. §14.2's three responses stay
 *     the only things that change a number, and a meeting is not one of them.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { founderMeetingRequests, type FounderMeetingRequest } from '../db/schema/meetings.js';

export interface MeetingRefused {
  ok: false;
  code:
    | 'not_found'
    | 'message_required'
    | 'message_too_long'
    | 'already_open'
    | 'already_answered';
  whatHappened: string;
  next: string;
}

function refuse(code: MeetingRefused['code'], whatHappened: string, next: string): MeetingRefused {
  return { ok: false, code, whatHappened, next };
}

/**
 * Long enough for a real note and short enough that nobody mistakes the box for
 * a thread. The number is a UI bound rather than a commercial rule: §30 is
 * satisfied by there being ONE message, not by how long it is.
 */
export const MEETING_MESSAGE_MAX = 1000;

/* ── The Founder's ask ────────────────────────────────────────────────────── */

export async function requestMeeting(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    associationId: string;
    founderUserId: string;
    message: string;
    actor: string;
    now?: Date;
  },
): Promise<{ ok: true; request: FounderMeetingRequest } | MeetingRefused> {
  const message = input.message.trim();
  if (!message) {
    return refuse(
      'message_required',
      'A meeting request needs something to say.',
      'Write a line about what you would like to talk about. Nothing you entered was lost.',
    );
  }
  if (message.length > MEETING_MESSAGE_MAX) {
    return refuse(
      'message_too_long',
      `That message is longer than ${MEETING_MESSAGE_MAX} characters.`,
      'Shorten it. Nothing you entered was lost.',
    );
  }

  return db.transaction(async (tx) => {
    // §11's boundary in the query: the campaign has to be this Founder's, and
    // the association has to be on it. The 0056 trigger re-checks the second
    // half regardless — the service refuses by name so the Founder reads a
    // sentence rather than a constraint.
    const [own] = await tx
      .select({ associationId: campaignAffiliateAssociations.id })
      .from(campaignAffiliateAssociations)
      .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
      .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
      .where(
        and(
          eq(campaignAffiliateAssociations.id, input.associationId),
          eq(campaignAffiliateAssociations.campaignId, input.campaignId),
          eq(founderClaimProfiles.claimedUserId, input.founderUserId),
        ),
      )
      .limit(1);
    if (!own) {
      return refuse(
        'not_found',
        'That Creator is not on this campaign.',
        'Open your roster to see who is.',
      );
    }

    const [open] = await tx
      .select({ id: founderMeetingRequests.id })
      .from(founderMeetingRequests)
      .where(
        and(
          eq(founderMeetingRequests.campaignId, input.campaignId),
          eq(founderMeetingRequests.associationId, input.associationId),
          eq(founderMeetingRequests.status, 'requested'),
        ),
      )
      .limit(1);
    if (open) {
      return refuse(
        'already_open',
        'You already asked this Creator, and they have not answered yet.',
        'They will see the first message. There is no way to send a second one.',
      );
    }

    const [request] = await tx
      .insert(founderMeetingRequests)
      .values({
        campaignId: input.campaignId,
        associationId: input.associationId,
        founderUserId: input.founderUserId,
        message,
      })
      .returning();

    await deps.audit({
      action: 'meeting.requested',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason:
        'Founder asked to meet this Creator before deciding. Records a mediated request only — ' +
        'it books no time, moves no terms, and carries no contact detail (§30, §11).',
      actorId: input.founderUserId,
    });

    return { ok: true as const, request: request! };
  });
}

/* ── The Creator's one answer ─────────────────────────────────────────────── */

export async function respondToMeetingRequest(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    requestId: string;
    affiliateUserId: string;
    answer: 'accepted' | 'declined';
    note?: string | undefined;
    now?: Date;
  },
): Promise<{ ok: true; request: FounderMeetingRequest } | MeetingRefused> {
  const now = input.now ?? new Date();
  const note = input.note?.trim() ?? '';
  if (note.length > MEETING_MESSAGE_MAX) {
    return refuse(
      'message_too_long',
      `That note is longer than ${MEETING_MESSAGE_MAX} characters.`,
      'Shorten it. Nothing you entered was lost.',
    );
  }

  return db.transaction(async (tx) => {
    // The request has to belong to an association this Creator's own account
    // holds. Somebody else's answers `not_found`, which is what a nonexistent
    // one answers too.
    const [owned] = await tx
      .select({ id: founderMeetingRequests.id, status: founderMeetingRequests.status })
      .from(founderMeetingRequests)
      .innerJoin(
        campaignAffiliateAssociations,
        eq(campaignAffiliateAssociations.id, founderMeetingRequests.associationId),
      )
      .innerJoin(
        affiliateSignupProfiles,
        eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
      )
      .where(
        and(
          eq(founderMeetingRequests.id, input.requestId),
          eq(affiliateSignupProfiles.claimedUserId, input.affiliateUserId),
        ),
      )
      .limit(1);
    if (!owned) {
      return refuse(
        'not_found',
        'That request could not be found.',
        'Open your campaign to see what is waiting for you.',
      );
    }

    // Conditional UPDATE, not select-then-update: two clicks race, and the
    // trigger would refuse the second anyway — this makes the refusal a
    // sentence rather than a 500.
    const answered = await tx
      .update(founderMeetingRequests)
      .set({
        status: input.answer,
        respondedAt: now,
        responseNote: note || null,
      })
      .where(
        and(
          eq(founderMeetingRequests.id, input.requestId),
          eq(founderMeetingRequests.status, 'requested'),
        ),
      )
      .returning();
    if (answered.length !== 1) {
      return refuse(
        'already_answered',
        'You already answered this one.',
        'Your first answer stands. Reload to see it.',
      );
    }

    await deps.audit({
      action: 'meeting.answered',
      targetType: 'campaign_affiliate_association',
      targetId: answered[0]!.associationId,
      internalReason:
        `Creator ${input.answer} the Founder's meeting request. ` +
        'Agreeing to talk changes no terms and no status (§14.2).',
      actorId: input.affiliateUserId,
    });

    return { ok: true as const, request: answered[0]! };
  });
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export interface MeetingRequestView {
  id: string;
  associationId: string;
  status: string;
  message: string;
  requestedAt: string;
  respondedAt: string | null;
  responseNote: string | null;
}

function serialize(row: FounderMeetingRequest): MeetingRequestView {
  return {
    id: row.id,
    associationId: row.associationId,
    status: row.status,
    message: row.message,
    requestedAt: row.requestedAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseNote: row.responseNote,
  };
}

/** The latest request per association, for a whole roster. One query. */
export async function latestMeetingRequests(
  db: Database,
  associationIds: readonly string[],
): Promise<Map<string, MeetingRequestView>> {
  if (associationIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(founderMeetingRequests)
    .where(inArray(founderMeetingRequests.associationId, [...associationIds]))
    .orderBy(desc(founderMeetingRequests.requestedAt));

  const latest = new Map<string, MeetingRequestView>();
  for (const row of rows) {
    if (!latest.has(row.associationId)) latest.set(row.associationId, serialize(row));
  }
  return latest;
}

/** Every open ask waiting on one Creator's account, across their campaigns. */
export async function openMeetingRequestsForCreator(
  db: Database,
  affiliateUserId: string,
): Promise<MeetingRequestView[]> {
  const rows = await db
    .select({ request: founderMeetingRequests })
    .from(founderMeetingRequests)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, founderMeetingRequests.associationId),
    )
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(affiliateSignupProfiles.claimedUserId, affiliateUserId),
        eq(founderMeetingRequests.status, 'requested'),
      ),
    )
    .orderBy(desc(founderMeetingRequests.requestedAt));
  return rows.map((r) => serialize(r.request));
}
