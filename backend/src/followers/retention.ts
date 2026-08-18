/**
 * §25.8 window 4 for the follow record — "Marketing consent: until unsubscribe
 * + 2 years", then irreversible anonymisation.
 *
 * That is the Spec's own window, not one derived from campaign resolution: a
 * follower email IS a marketing consent, and inventing a rule where the Spec
 * speaks is §1 rule 6 in the other direction. Window 5 separately covers the
 * token hashes. Window 1 does not apply, because a follower has no
 * reservation.
 *
 * ── The shape is `invitations/retention.ts`, copied for its reasons ─────────
 *   * ONE transaction, with token revocation FIRST and inside it. A revoked
 *     token beside live content is not compliance, and a crash between the two
 *     leaves that state permanently.
 *   * Every content column nulled and `anonymised_at` stamped in the same
 *     statement, so the 0050 two-shape CHECK can never see a half-swept row.
 *   * The provenance columns survive because the column-scoped GRANT permits
 *     exactly the content and lifecycle columns and nothing else — the fact
 *     that somebody asked, for which campaign, from where, and under which
 *     consent version, outlives the text of it.
 *   * Exactly one `audit_events` row, naming the reason and carrying NO copy
 *     of what was deleted. An audit row that quoted the address would put the
 *     personal data back in an insert-only table.
 *
 * Irreversibility is a DATABASE property, not a service one: the two-shape
 * CHECK plus 0050's trigger refuse any later write to an anonymised row. The
 * sweep is idempotent by construction — an anonymised row no longer matches
 * the due query.
 */

import { and, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignFollowers } from '../db/schema/followers.js';
import { secureTokens } from '../db/schema/tokens.js';
import { eq } from 'drizzle-orm';
import { FOLLOW_CONSENT_RETENTION_YEARS } from './logic.js';

export interface FollowRetentionDeps {
  db: Database;
  audit: (event: {
    action: string;
    targetType: string;
    targetId: string | null;
    internalReason: string;
  }) => Promise<void>;
}

export interface FollowRetentionResult {
  considered: number;
  anonymised: number;
}

/** The cutoff: anything unfollowed at or before this instant is due. */
export function followRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - FOLLOW_CONSENT_RETENTION_YEARS);
  return cutoff;
}

export async function sweepFollowConsent(
  deps: FollowRetentionDeps,
  now: Date = new Date(),
): Promise<FollowRetentionResult> {
  const cutoff = followRetentionCutoff(now);

  const due = await deps.db
    .select({ id: campaignFollowers.id, campaignId: campaignFollowers.campaignId })
    .from(campaignFollowers)
    .where(
      and(
        isNotNull(campaignFollowers.unfollowedAt),
        isNull(campaignFollowers.anonymisedAt),
        lte(campaignFollowers.unfollowedAt, cutoff),
      ),
    );

  const result: FollowRetentionResult = { considered: due.length, anonymised: 0 };

  for (const row of due) {
    // Each in its own transaction: one follower's failure must not roll back
    // the rest, the same way 08c reveals each association separately.
    await deps.db.transaction(async (tx) => {
      // Token revocation FIRST, inside the transaction.
      await tx
        .update(secureTokens)
        .set({ revokedAt: now, revokedReason: 'draft_anonymised' })
        .where(and(eq(secureTokens.campaignFollowerId, row.id), isNull(secureTokens.revokedAt)));

      await tx
        .update(campaignFollowers)
        .set({
          email: null,
          emailNormalized: null,
          consentText: null,
          anonymisedAt: now,
        })
        .where(eq(campaignFollowers.id, row.id));
    });

    await deps.audit({
      action: 'follow.consent_anonymised',
      targetType: 'campaign',
      targetId: row.campaignId,
      // No copy of what was deleted — not the address, not the consent text.
      internalReason: `§25.8 window 4: marketing consent anonymised ${FOLLOW_CONSENT_RETENTION_YEARS} years after unfollow`,
    });
    result.anonymised += 1;
  }

  return result;
}
