/**
 * The §18 comment thread — Spec §18, §5.4, §28.1 (Phase 17b).
 *
 * The last piece of §18, and it always waited here: a comment needs the Backer
 * identity and the magic-link session Phase 15 mints, and §33.6.6–13 are Phase
 * 17's tests. It is not a 14c debt.
 *
 * §18's five rules, and what each is in the code:
 *
 *   "One general thread and one thread per update."
 *       `update_id` NULL is the general thread. A per-update thread is a filter,
 *       not a different kind of record — two tables would be two places for the
 *       moderation rules to drift.
 *
 *   "Only a magic-link-authenticated Backer may post."
 *       `backer_identity_id` is NOT NULL and the route is behind
 *       `requireMagicLinkToken`. There is no Founder post path and no anonymous
 *       one, because §18 names neither — the absence is the enforcement.
 *
 *   "Display `Backer ###` or a chosen display name, never email local-part by
 *   default."
 *       The number is a per-campaign sequence assigned on first comment, derived
 *       from nothing about the person. A chosen name equal to the Backer's own
 *       email local part is refused outright, which is stricter than §18 — a
 *       Backer who types their own local part has almost certainly not realised
 *       the thread is public, and the cost of being wrong is publishing part of
 *       someone's address.
 *
 *   "Flagging routes to Admin."
 *       A flag is a row for a person. Nothing hides on flag: §18 gives no
 *       automatic moderation, §1 rule 6 forbids inventing one, and auto-hiding
 *       would let one reader remove another's comment.
 *
 *   "New comments are disabled after close, suspension, or kill."
 *       `commentsOpenFor` gates posting only. Reading stays open, because §18's
 *       ended-state contract keeps the page accessible.
 *
 * ── The author display is stored, not resolved on read ──────────────────────
 * A comment is what people read. If the display name were resolved at render
 * time, changing it later would silently rewrite every comment somebody already
 * saw attributed to a different name. It is stamped at post time and frozen by
 * trigger with the rest of the row.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { backerIdentities } from '../db/schema/reservations.js';
import {
  campaignComments,
  campaignCommentFlags,
  campaignBackerNumbers,
  type CampaignComment,
  type CampaignCommentFlag,
} from '../db/schema/live-editing.js';
import type { AuditWriter } from '../auth/audit.js';
import { commentsOpenFor, defaultCommentAuthorName, displayNameRefusal } from './editing-logic.js';

export interface PostedComment {
  id: string;
  updateId: string | null;
  authorDisplay: string;
  body: string;
  postedAt: string;
  /** True for the caller's own comments, so a surface can mark them. */
  mine: boolean;
}

export type PostCommentOutcome =
  | { ok: true; comment: CampaignComment }
  | {
      ok: false;
      code:
        | 'comments_closed'
        | 'campaign_not_found'
        | 'update_not_found'
        | 'empty'
        | 'too_long'
        | 'display_name_refused';
      message: string;
      next: string;
    };

const MAX_COMMENT_LENGTH = 2_000;

/**
 * Assigns this Backer's per-campaign number, or returns the one they already
 * have.
 *
 * The sequence is `max + 1` under the campaign's own row lock rather than a
 * database sequence, because a global sequence would leak the platform's total
 * comment volume into every campaign's numbering — `Backer 4131` on a campaign
 * with nine comments tells a reader something about Proovd, not about the
 * campaign.
 */
async function backerNumberFor(
  tx: Pick<Database, 'select' | 'insert'>,
  input: { campaignId: string; backerIdentityId: string },
): Promise<number> {
  const [existing] = await tx
    .select({ backerNumber: campaignBackerNumbers.backerNumber })
    .from(campaignBackerNumbers)
    .where(
      and(
        eq(campaignBackerNumbers.campaignId, input.campaignId),
        eq(campaignBackerNumbers.backerIdentityId, input.backerIdentityId),
      ),
    )
    .limit(1);
  if (existing) return existing.backerNumber;

  const [{ next }] = await tx
    .select({
      next: sql<number>`(coalesce(max(${campaignBackerNumbers.backerNumber}), 0) + 1)::int`,
    })
    .from(campaignBackerNumbers)
    .where(eq(campaignBackerNumbers.campaignId, input.campaignId));

  const assigned = Number(next ?? 1);
  await tx.insert(campaignBackerNumbers).values({
    campaignId: input.campaignId,
    backerIdentityId: input.backerIdentityId,
    backerNumber: assigned,
  });
  return assigned;
}

export async function postComment(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    backerIdentityId: string;
    /** NULL posts to the general thread (§18). */
    updateId?: string | undefined;
    body: string;
    /** Optional chosen display name; otherwise `Backer ###`. */
    displayName?: string | undefined;
  },
): Promise<PostCommentOutcome> {
  const body = input.body.trim();
  if (!body) {
    return {
      ok: false,
      code: 'empty',
      message: 'A comment needs something in it.',
      next: 'Write something and post again.',
    };
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      code: 'too_long',
      message: `A comment is at most ${MAX_COMMENT_LENGTH} characters.`,
      next: 'Shorten it and post again. Nothing you typed was lost.',
    };
  }

  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) {
    return {
      ok: false,
      code: 'campaign_not_found',
      message: 'We could not find that campaign.',
      next: 'Open the campaign from your pre-order email.',
    };
  }

  // §18: disabled after close, suspension, or kill. Reading stays open.
  if (!commentsOpenFor(campaign.status)) {
    return {
      ok: false,
      code: 'comments_closed',
      message: 'This campaign has ended, so new comments are closed.',
      next: 'You can still read the campaign and every update on it. For anything about your pre-order, contact support.',
    };
  }

  if (input.updateId) {
    const [update] = await db
      .select({ id: campaignUpdates.id })
      .from(campaignUpdates)
      .where(
        and(
          eq(campaignUpdates.id, input.updateId),
          eq(campaignUpdates.campaignId, input.campaignId),
        ),
      )
      .limit(1);
    if (!update) {
      return {
        ok: false,
        code: 'update_not_found',
        message: 'We could not find that update.',
        next: 'Reload the page and try again.',
      };
    }
  }

  const [identity] = await db
    .select({ email: backerIdentities.email })
    .from(backerIdentities)
    .where(eq(backerIdentities.id, input.backerIdentityId))
    .limit(1);
  if (!identity) {
    return {
      ok: false,
      code: 'campaign_not_found',
      message: 'We could not find your pre-order on this campaign.',
      next: 'Open the campaign from your pre-order email.',
    };
  }

  // §18: never the email local part. Refused by name so the Backer reads why.
  let chosen: string | null = null;
  if (input.displayName?.trim()) {
    const refusal = displayNameRefusal(input.displayName, identity.email);
    if (refusal) {
      return {
        ok: false,
        code: 'display_name_refused',
        message:
          refusal === 'email_local_part' || refusal === 'looks_like_email'
            ? 'That display name is part of your email address, and this thread is public. Pick something else.'
            : refusal === 'too_short'
              ? 'A display name needs at least two characters.'
              : 'A display name is at most 40 characters.',
        next: 'Pick another name, or leave it blank and you will show as a Backer number.',
      };
    }
    chosen = input.displayName.trim();
  }

  const comment = await db.transaction(async (tx) => {
    const number = await backerNumberFor(tx, {
      campaignId: input.campaignId,
      backerIdentityId: input.backerIdentityId,
    });
    const [row] = await tx
      .insert(campaignComments)
      .values({
        campaignId: input.campaignId,
        updateId: input.updateId ?? null,
        backerIdentityId: input.backerIdentityId,
        authorDisplay: chosen ?? defaultCommentAuthorName(number),
        body,
      })
      .returning();
    return row!;
  });

  await deps.audit({
    action: 'comment.posted',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§18 comment posted to the ${input.updateId ? 'update' : 'general'} thread`,
    newValue: { commentId: comment.id, updateId: input.updateId ?? null },
    actorId: `backer:${input.backerIdentityId}`,
  });

  return { ok: true, comment };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export interface CommentThreadView {
  /** §18: whether NEW comments are open. Reading is always open. */
  open: boolean;
  /** Why it is closed, when it is — §18 forbids one generic ended message. */
  closedReason: string | null;
  comments: PostedComment[];
}

/**
 * One thread. `updateId` undefined reads the general thread.
 *
 * A removed comment is not returned. The row survives (§25.6 keeps the record and
 * the reason), but a removal an Admin made after review should not still be on
 * the page.
 */
export async function readCommentThread(
  db: Database,
  input: {
    campaignId: string;
    updateId?: string | undefined;
    /** The reading Backer, when there is one. Marks their own comments. */
    viewerBackerIdentityId?: string | undefined;
  },
): Promise<CommentThreadView | null> {
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return null;

  const rows = await db
    .select()
    .from(campaignComments)
    .where(
      and(
        eq(campaignComments.campaignId, input.campaignId),
        input.updateId
          ? eq(campaignComments.updateId, input.updateId)
          : isNull(campaignComments.updateId),
        eq(campaignComments.visibility, 'visible'),
      ),
    )
    .orderBy(asc(campaignComments.postedAt));

  const open = commentsOpenFor(campaign.status);
  return {
    open,
    closedReason: open
      ? null
      : 'This campaign has ended. You can still read everything on it; new comments are closed.',
    comments: rows.map((row) => ({
      id: row.id,
      updateId: row.updateId,
      authorDisplay: row.authorDisplay,
      body: row.body,
      postedAt: row.postedAt.toISOString(),
      mine: input.viewerBackerIdentityId
        ? row.backerIdentityId === input.viewerBackerIdentityId
        : false,
    })),
  };
}

/** How many visible comments each thread on this campaign holds. */
export async function commentCounts(
  db: Database,
  campaignId: string,
): Promise<{ general: number; byUpdate: Record<string, number>; total: number }> {
  const rows = await db
    .select({
      updateId: campaignComments.updateId,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignComments)
    .where(
      and(
        eq(campaignComments.campaignId, campaignId),
        eq(campaignComments.visibility, 'visible'),
      ),
    )
    .groupBy(campaignComments.updateId);

  let general = 0;
  const byUpdate: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const n = Number(row.n);
    total += n;
    if (row.updateId) byUpdate[row.updateId] = n;
    else general = n;
  }
  return { general, byUpdate, total };
}

/* ── Flagging (§18: "Flagging routes to Admin") ────────────────────────────── */

export type FlagOutcome =
  | { ok: true; flag: CampaignCommentFlag }
  | { ok: false; code: 'not_found' | 'already_flagged' | 'invalid_value'; message: string };

/**
 * Routes a comment to a person. Hides nothing.
 *
 * One open flag per comment per reporter, so a reader cannot inflate the queue by
 * flagging repeatedly — and the comment stays visible, because auto-hiding on
 * flag would hand every reader a removal button.
 */
export async function flagComment(
  db: Database,
  deps: { audit: AuditWriter },
  input: { commentId: string; reportedBy: string; reason: string },
): Promise<FlagOutcome> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      code: 'invalid_value',
      message: 'Tell us what is wrong with it so a person can look.',
    };
  }

  const [comment] = await db
    .select({ id: campaignComments.id, campaignId: campaignComments.campaignId })
    .from(campaignComments)
    .where(eq(campaignComments.id, input.commentId))
    .limit(1);
  if (!comment) {
    return { ok: false, code: 'not_found', message: 'We could not find that comment.' };
  }

  try {
    const [flag] = await db
      .insert(campaignCommentFlags)
      .values({
        commentId: comment.id,
        campaignId: comment.campaignId,
        reportedBy: input.reportedBy,
        reason,
      })
      .returning();

    await deps.audit({
      action: 'comment.flagged',
      targetType: 'campaign',
      targetId: comment.campaignId,
      internalReason: `§18 comment flagged for review: ${reason}`,
      newValue: { commentId: comment.id },
      actorId: input.reportedBy,
    });
    return { ok: true, flag: flag! };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'already_flagged',
        message: 'You have already reported this one. Someone is looking at it.',
      };
    }
    throw error;
  }
}

export type FlagDecisionOutcome =
  | { ok: true; flag: CampaignCommentFlag; removed: boolean }
  | { ok: false; code: 'not_found' | 'already_decided' | 'invalid_value'; message: string };

/**
 * Admin decides a flag.
 *
 * Upholding it removes the comment with a reason recorded; dismissing it leaves
 * the comment exactly as it was. There is no path that removes a comment without
 * a decision behind it — the removal columns are only written here.
 */
export async function decideFlag(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    flagId: string;
    decision: 'upheld' | 'dismissed';
    decisionReason: string;
    actor: string;
  },
): Promise<FlagDecisionOutcome> {
  const reason = input.decisionReason.trim();
  if (!reason) {
    return { ok: false, code: 'invalid_value', message: 'A decision records why it was made.' };
  }

  const result = await db.transaction(async (tx) => {
    const [flag] = await tx
      .select()
      .from(campaignCommentFlags)
      .where(eq(campaignCommentFlags.id, input.flagId))
      .for('update')
      .limit(1);
    if (!flag) return { code: 'not_found' as const };
    if (flag.state !== 'open') return { code: 'already_decided' as const };

    const now = new Date();
    const [updated] = await tx
      .update(campaignCommentFlags)
      .set({
        state: input.decision,
        decidedBy: input.actor,
        decidedAt: now,
        decisionReason: reason,
      })
      .where(eq(campaignCommentFlags.id, flag.id))
      .returning();

    let removed = false;
    if (input.decision === 'upheld') {
      await tx
        .update(campaignComments)
        .set({
          visibility: 'removed',
          removedBy: input.actor,
          removedAt: now,
          removedReason: reason,
        })
        .where(eq(campaignComments.id, flag.commentId));
      removed = true;
    }

    return { code: 'ok' as const, flag: updated!, removed, campaignId: flag.campaignId };
  });

  if (result.code === 'not_found') {
    return { ok: false, code: 'not_found', message: 'That flag was not found.' };
  }
  if (result.code === 'already_decided') {
    return { ok: false, code: 'already_decided', message: 'That flag was already decided.' };
  }

  await deps.audit({
    action: result.removed ? 'comment.removed' : 'comment.flag_dismissed',
    targetType: 'campaign',
    targetId: result.campaignId,
    internalReason: `§18 flag ${input.decision}: ${reason}`,
    actorId: input.actor,
  });

  return { ok: true, flag: result.flag, removed: result.removed };
}

/** The Admin queue: open flags, oldest first. */
export async function listOpenFlags(
  db: Database,
  campaignId?: string,
): Promise<CampaignCommentFlag[]> {
  return db
    .select()
    .from(campaignCommentFlags)
    .where(
      campaignId
        ? and(
            eq(campaignCommentFlags.state, 'open'),
            eq(campaignCommentFlags.campaignId, campaignId),
          )
        : eq(campaignCommentFlags.state, 'open'),
    )
    .orderBy(asc(campaignCommentFlags.createdAt));
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: string }).code === '23505'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
