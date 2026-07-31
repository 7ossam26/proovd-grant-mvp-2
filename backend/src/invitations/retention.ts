/**
 * The unclaimed-draft retention sweep — Spec §7, §25.8, §33.1.3.
 *
 * §25.8: "Unclaimed draft content: delete/anonymize 30 calendar days after most
 * recent invitation send; retain minimum audit event."
 * §7: "Resend rotates the token … and restarts the 30-day unclaimed-draft
 * retention period."
 *
 * ── The clock is the most recent send ───────────────────────────────────────
 * Not the draft's creation, not the token's `expires_at`, not `updated_at`.
 * §33.1.3 is named precisely — "30-day deletion/anonymization runs from most
 * recent send" — so the sweep reads `max(sent_at)` from the append-only send
 * table, which is why that table is append-only and why UPDATE on `sent_at` is
 * revoked from the application role. A retention clock that a later statement
 * could move is not a retention policy.
 *
 * A draft that was created and never sent has no clock at all and is never
 * swept: nothing was disclosed to anyone, and there is no send to measure from.
 * It stays until an Admin revokes it.
 *
 * ── Revocation and anonymisation are one transaction ────────────────────────
 * A revoked token beside live draft content is not compliance, and neither is
 * anonymised content behind a link that still resolves. The token service's
 * `revokeDraftTokens` takes the transaction so both land together or neither
 * does — a crash between them would otherwise leave the halfway state
 * permanently, with nothing scheduled to finish it.
 *
 * ── What "minimum audit evidence" keeps ─────────────────────────────────────
 * The rows survive; their content does not. What remains is that an invitation
 * existed, which campaign it belonged to, when it was sent and by whom, that it
 * was never claimed, and when it was anonymised. `audit_events` is insert-only
 * and references these ids, so deleting the rows outright would leave an audit
 * trail pointing at nothing — which is not a stronger privacy position, just an
 * unauditable one.
 *
 * ── Why the prospect is only anonymised conditionally ───────────────────────
 * §25.8 keeps Founder account data for account life + 7 years. A prospect who
 * claimed any draft has become an account and leaves this sweep entirely; a
 * prospect with another live draft is still mid-conversation. So the person's
 * details go only when every draft they have is gone.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import {
  founderProspects,
  campaignDrafts,
  campaignInvitationSends,
} from '../db/schema/invitations.js';
import { auditEvents } from '../db/schema/integrity.js';

/** §7 and §25.8 both state 30 calendar days. Not a business-day count. */
export const UNCLAIMED_DRAFT_RETENTION_DAYS = 30;

export interface SweepResult {
  /** Draft ids anonymised on this run. */
  draftIds: string[];
  /** Prospect ids whose last draft went with them. */
  prospectIds: string[];
  tokensRevoked: number;
}

export interface DueDraft {
  draftId: string;
  prospectId: string;
  lastSentAt: Date;
}

/**
 * Drafts whose most recent send is older than the retention window and which
 * nobody claimed.
 *
 * `now` is injected so a test can travel forward without waiting a month and
 * without mutating `sent_at`, which the database will not permit anyway.
 */
export async function findDueDrafts(db: Database, now: Date): Promise<DueDraft[]> {
  const cutoff = new Date(now.getTime() - UNCLAIMED_DRAFT_RETENTION_DAYS * 86_400_000);

  const rows = await db
    .select({
      draftId: campaignDrafts.id,
      prospectId: campaignDrafts.prospectId,
      lastSentAt: sql<Date>`max(${campaignInvitationSends.sentAt})`.as('last_sent_at'),
    })
    .from(campaignDrafts)
    .innerJoin(
      campaignInvitationSends,
      eq(campaignInvitationSends.draftId, campaignDrafts.id),
    )
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(
      and(
        isNull(campaignDrafts.anonymisedAt),
        // ── Two independent exemptions for a claimed draft, on purpose ─────
        // §25.8 keeps Founder account data for account life + 7 years, so a
        // claimed draft leaves this sweep entirely. Both of these say so.
        //
        // They are redundant today and that is the point. `claimed_user_id` is
        // set by the claim flow, and if that flow ever creates an account
        // without setting it, this query would anonymise a live Founder's
        // record 30 days after their invitation. Two things have to be wrong
        // before real data is destroyed, rather than one.
        isNull(founderProspects.claimedUserId),
        ne(campaignDrafts.status, 'claimed'),
      ),
    )
    .groupBy(campaignDrafts.id, campaignDrafts.prospectId)
    // A resend restarts the clock, so the HAVING is on the maximum, not on any
    // individual send (§7).
    .having(sql`max(${campaignInvitationSends.sentAt}) <= ${cutoff.toISOString()}`);

  return rows;
}

/**
 * Anonymises one due draft, and its prospect when that prospect has nothing
 * else left. One transaction, including the token revocation.
 */
export async function anonymiseDraft(
  db: Database,
  tokens: TokenService,
  due: DueDraft,
  now: Date,
): Promise<{ tokensRevoked: number; prospectAnonymised: boolean }> {
  return db.transaction(async (tx) => {
    const revoked = await tokens.revokeDraftTokens(due.draftId, 'draft_anonymised', tx);

    // The draft's own personalised content.
    await tx
      .update(campaignDrafts)
      .set({
        whatWeUnderstood: null,
        whyInvited: null,
        expectedSetupTime: null,
        status: 'expired',
        anonymisedAt: now,
      })
      .where(eq(campaignDrafts.id, due.draftId));

    // The recipient carried on every send row. `sent_at`, `token_version`, and
    // `status` are untouched — a column-level grant is what allows exactly
    // these two and nothing else (migration 0005).
    await tx
      .update(campaignInvitationSends)
      .set({ recipientEmail: null, recipientName: null })
      .where(eq(campaignInvitationSends.draftId, due.draftId));

    // The person, only if this was their last draft.
    const remaining = await tx
      .select({ id: campaignDrafts.id })
      .from(campaignDrafts)
      .where(
        and(
          eq(campaignDrafts.prospectId, due.prospectId),
          isNull(campaignDrafts.anonymisedAt),
        ),
      );

    const prospectAnonymised = remaining.length === 0;
    if (prospectAnonymised) {
      await tx
        .update(founderProspects)
        .set({
          legalName: null,
          preferredName: null,
          email: null,
          phone: null,
          productName: null,
          productUrl: null,
          launchFrame: null,
          usAgeFit: null,
          deliveryFeasibility: null,
          compensationExpectations: null,
          affiliateSourcingHypothesis: null,
          adminNotes: null,
          discoveryEvidence: null,
          anonymisedAt: now,
        })
        .where(eq(founderProspects.id, due.prospectId));
    }

    // The minimum audit evidence §25.8 requires stays here. Deliberately no
    // name, address, or product: an audit row that quoted what it deleted
    // would be a copy of the thing, filed somewhere insert-only.
    await tx.insert(auditEvents).values({
      actor: 'system:unclaimed-draft-retention',
      targetType: 'campaign_draft',
      targetId: due.draftId,
      action: 'invitation.anonymised',
      internalReason: `${UNCLAIMED_DRAFT_RETENTION_DAYS} calendar days elapsed since the most recent send with no claim`,
      customerExplanation: null,
      newValue: {
        lastSentAt: due.lastSentAt,
        tokensRevoked: revoked,
        prospectAnonymised,
      },
    });

    return { tokensRevoked: revoked, prospectAnonymised };
  });
}

/**
 * The whole sweep. Safe to run twice: an anonymised draft no longer matches
 * `findDueDrafts`, and the database refuses to un-anonymise one regardless.
 */
export async function sweepUnclaimedDrafts(
  db: Database,
  tokens: TokenService,
  now: Date = new Date(),
): Promise<SweepResult> {
  const due = await findDueDrafts(db, now);

  const draftIds: string[] = [];
  const prospectIds: string[] = [];
  let tokensRevoked = 0;

  for (const draft of due) {
    const result = await anonymiseDraft(db, tokens, draft, now);
    draftIds.push(draft.draftId);
    if (result.prospectAnonymised) prospectIds.push(draft.prospectId);
    tokensRevoked += result.tokensRevoked;
  }

  return { draftIds, prospectIds, tokensRevoked };
}

/** Used by Admin to explain when a draft will go. Null when nothing was sent. */
export function retentionDueAt(lastSentAt: Date | null): Date | null {
  if (!lastSentAt) return null;
  return new Date(lastSentAt.getTime() + UNCLAIMED_DRAFT_RETENTION_DAYS * 86_400_000);
}
