/**
 * The Creator posts a Founder can see, and deviation 2's acknowledgement —
 * Founder Dashboard Session D. Migration 0057.
 *
 * ── The read is §11's projection, and it adds no column ─────────────────────
 * A §17 post submission carries the public post URL, the channel, the seven
 * verification checks, the correction detail, and the enforcement reason. The
 * Founder gets the first two, the outcome, and nothing else: the checklist is
 * Admin's working record, the correction detail is between Proovd and the
 * Creator, and the enforcement reason is §25.6's internal column. The person
 * behind the handle stays behind it — the query joins `affiliate_prospects` for
 * `public_handle` alone, the same seven-column boundary
 * `listFounderVisibleRoster` has held since Phase 08a.
 *
 * ── The acknowledgement is a RECORDED DEVIATION ─────────────────────────────
 * See `db/schema/posts.ts` for the full statement. The short version: the
 * reference's `Like it` toasts "creator will see it", which makes it a message,
 * and §30 defers direct Founder–Affiliate messaging. It is built on §22.9's
 * treatment — recorded, routed through Proovd, no free text — and this module
 * cannot do the three things that would make it something else:
 *
 *  1. It cannot carry a note. No parameter, no column, no route field.
 *  2. It cannot be undone. There is no withdraw function and no DELETE grant.
 *  3. It cannot decide anything. Nothing here reads or writes a verification, an
 *     attribution status, an earnings row, or an association status. §17's
 *     outcomes are Admin's and stay Admin's.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import {
  founderPostAcknowledgements,
  type FounderPostAcknowledgement,
} from '../db/schema/posts.js';

export interface CreatorPostView {
  submissionId: string;
  associationId: string;
  /** §11: the public handle, and nothing that identifies the person behind it. */
  publicHandle: string | null;
  /** §17 step 4: "the public post URL." A public post, on a public page. */
  postUrl: string;
  channel: string | null;
  submittedAt: string;
  /** §17's own outcome. Already Founder-visible through Explore section 5. */
  status: string;
  /** Deviation 2: whether THIS Founder has acknowledged it. */
  acknowledgedAt: string | null;
  /**
   * §17's `correction_needed` and `rejected` are outcomes Proovd found a problem
   * with; an acknowledgement then would tell the Creator their Founder liked
   * work Proovd has just asked them to change. False carries no reason here —
   * the surface renders the register's sentence.
   */
  acknowledgeable: boolean;
}

/** §17's two problem outcomes. Acknowledging either is refused by name. */
const UNDER_CORRECTION = new Set(['correction_needed', 'rejected']);

export interface PostAckRefused {
  ok: false;
  code: 'not_found' | 'under_correction';
  whatHappened: string;
  next: string;
}

/* ── The read ─────────────────────────────────────────────────────────────── */

export async function listCreatorPosts(
  db: Database,
  input: { campaignId: string; founderUserId: string },
): Promise<CreatorPostView[]> {
  const rows = await db
    .select({
      submissionId: creatorPostSubmissions.id,
      associationId: creatorPostSubmissions.associationId,
      publicHandle: affiliateProspects.publicHandle,
      postUrl: creatorPostSubmissions.postUrl,
      channel: creatorPostSubmissions.channel,
      submittedAt: creatorPostSubmissions.submittedAt,
      status: creatorPostSubmissions.status,
    })
    .from(creatorPostSubmissions)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, creatorPostSubmissions.associationId),
    )
    .leftJoin(
      affiliateProspects,
      eq(affiliateProspects.id, campaignAffiliateAssociations.prospectId),
    )
    .where(eq(creatorPostSubmissions.campaignId, input.campaignId))
    .orderBy(desc(creatorPostSubmissions.submittedAt));

  if (rows.length === 0) return [];

  const acks = await db
    .select({
      submissionId: founderPostAcknowledgements.submissionId,
      acknowledgedAt: founderPostAcknowledgements.acknowledgedAt,
    })
    .from(founderPostAcknowledgements)
    .where(
      and(
        eq(founderPostAcknowledgements.founderUserId, input.founderUserId),
        inArray(
          founderPostAcknowledgements.submissionId,
          rows.map((r) => r.submissionId),
        ),
      ),
    );
  const acknowledged = new Map(acks.map((a) => [a.submissionId, a.acknowledgedAt.toISOString()]));

  return rows.map((row) => ({
    submissionId: row.submissionId,
    associationId: row.associationId,
    publicHandle: row.publicHandle,
    postUrl: row.postUrl,
    channel: row.channel,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    acknowledgedAt: acknowledged.get(row.submissionId) ?? null,
    acknowledgeable: !UNDER_CORRECTION.has(row.status),
  }));
}

/* ── Deviation 2: the acknowledgement ─────────────────────────────────────── */

/**
 * Takes a submission id and nothing else. There is no `note` parameter, and
 * adding one would need a column that does not exist and a grant that is
 * revoked — which is the point of building it this way rather than trusting a
 * later session to remember.
 *
 * Idempotent by the unique index: a second click returns the first row
 * unchanged and `created` is false, so the caller knows not to send again.
 */
export async function acknowledgeCreatorPost(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; submissionId: string; founderUserId: string },
): Promise<
  { ok: true; created: boolean; acknowledgement: FounderPostAcknowledgement } | PostAckRefused
> {
  return db.transaction(async (tx) => {
    // §11's boundary in the query: the post has to be on a campaign this
    // Founder's own claim profile holds. The 0057 trigger re-checks that the
    // post, the association and the campaign agree; this refuses by name so the
    // Founder reads a sentence rather than a constraint.
    const [post] = await tx
      .select({
        submissionId: creatorPostSubmissions.id,
        associationId: creatorPostSubmissions.associationId,
        status: creatorPostSubmissions.status,
      })
      .from(creatorPostSubmissions)
      .innerJoin(campaigns, eq(campaigns.id, creatorPostSubmissions.campaignId))
      .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
      .where(
        and(
          eq(creatorPostSubmissions.id, input.submissionId),
          eq(creatorPostSubmissions.campaignId, input.campaignId),
          eq(founderClaimProfiles.claimedUserId, input.founderUserId),
        ),
      )
      .limit(1);
    if (!post) {
      return {
        ok: false as const,
        code: 'not_found' as const,
        whatHappened: 'That post could not be found on this campaign.',
        next: 'Reload the page to see the posts that are up.',
      };
    }

    if (UNDER_CORRECTION.has(post.status)) {
      return {
        ok: false as const,
        code: 'under_correction' as const,
        whatHappened: 'Proovd has asked for a change to this post.',
        next: 'Nothing was sent. It is not one to send a note about until that is settled.',
      };
    }

    const [existing] = await tx
      .select()
      .from(founderPostAcknowledgements)
      .where(
        and(
          eq(founderPostAcknowledgements.submissionId, input.submissionId),
          eq(founderPostAcknowledgements.founderUserId, input.founderUserId),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: true as const, created: false, acknowledgement: existing };
    }

    const [acknowledgement] = await tx
      .insert(founderPostAcknowledgements)
      .values({
        campaignId: input.campaignId,
        associationId: post.associationId,
        submissionId: input.submissionId,
        founderUserId: input.founderUserId,
      })
      .returning();

    await deps.audit({
      action: 'creator_post.acknowledged',
      targetType: 'creator_post_submission',
      targetId: input.submissionId,
      internalReason:
        'Founder acknowledged this Creator post. Records that they saw it and nothing else — ' +
        'no note, no verification, no attribution or earnings effect (§30, §17).',
      actorId: input.founderUserId,
    });

    return { ok: true as const, created: true, acknowledgement: acknowledgement! };
  });
}
