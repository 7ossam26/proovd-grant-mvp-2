/**
 * Account standing as an access decision — §26.7, §22.7, §29.4.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * Two records already decide whether a Founder is in good standing, and both
 * were written by Admin surfaces that nothing on the request path ever read:
 *
 *   `founder_access_actions`  §26.7's suspend/restore, with its reason, review
 *                             owner, and next review date.
 *   `founder_ghost_bans`      §22.7's one strike. Permanent; there is no lift.
 *
 * Before this file, suspending a Founder changed what the Admin workspace
 * *said* about them and nothing about what they could *do*: an existing session
 * kept full access to `/api/founder/*` — their campaign workspace, their build,
 * their live edits, their fulfillment record — until the session expired on its
 * own. A banned Founder was in the same position. That is the exact failure
 * §29's enforcement records exist to prevent, and it is invisible from the
 * Admin side because the surface that records the decision looks like it worked.
 *
 * ── Why a gate rather than a session revocation ─────────────────────────────
 * Revoking the session rows at suspension time would work once and then rot:
 * the person signs in again the next morning and is back, because sign-in
 * checks a credential and nothing checks standing. Deciding it per request
 * means a suspension takes effect on the next call and a restore does too,
 * with no session bookkeeping to get wrong — the same reasoning
 * `policyReacceptanceGate` (§29.8) is built on, and this mounts beside it.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * It does not touch `/api/creator`. §29's Creator enforcement (pause,
 * termination) is recorded per ASSOCIATION — a Creator paused on one campaign
 * is not paused on another — and the association status already governs every
 * campaign-scoped read. There is no account-level Creator ban in the Spec, and
 * inventing one here would be §1 rule 6.
 *
 * It does not touch `/api/account/*`. A suspended person must still be able to
 * learn that they are signed in and reach support — a suspension you cannot
 * ask about is a ban wearing a different word, which is the same reason §29.8
 * puts its acceptance route outside the gated prefixes.
 *
 * It reads; it never writes. Nothing here suspends anybody.
 */

import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { desc, eq } from 'drizzle-orm';
import type { Auth } from '../auth/auth.js';
import type { Database } from '../db/client.js';
import { founderAccessActions } from '../db/schema/founder-workspace.js';
import { founderGhostBans } from '../db/schema/fulfillment.js';

/** What a standing read concluded. `null` means "in good standing". */
export type StandingBlock =
  | { kind: 'suspended'; reviewOwner: string | null; nextReviewAt: Date | null }
  | { kind: 'banned' };

/**
 * The standing of one account, from the two records that decide it.
 *
 * A ban outranks a suspension because §22.7's ban is permanent and §26.7's
 * suspension is a review that ends — telling a permanently banned Founder that
 * somebody will get back to them on a date is a promise nothing will honour
 * (§1.4).
 */
export async function readFounderStanding(
  db: Database,
  userId: string,
): Promise<StandingBlock | null> {
  const [ban] = await db
    .select({ id: founderGhostBans.id })
    .from(founderGhostBans)
    .where(eq(founderGhostBans.founderUserId, userId))
    .limit(1);

  if (ban) return { kind: 'banned' };

  // Latest action wins: `suspend` and `restore` are an append-only sequence
  // per person, so the standing is whichever came last. Ordering on the
  // recorded instant rather than on insertion order, because that is the
  // column the Admin workspace's own `deriveAccountState` reads.
  const [latest] = await db
    .select({
      action: founderAccessActions.action,
      reviewOwner: founderAccessActions.reviewOwner,
      nextReviewAt: founderAccessActions.nextReviewAt,
    })
    .from(founderAccessActions)
    .where(eq(founderAccessActions.userId, userId))
    .orderBy(desc(founderAccessActions.occurredAt))
    .limit(1);

  if (latest?.action === 'suspend') {
    return {
      kind: 'suspended',
      reviewOwner: latest.reviewOwner ?? null,
      nextReviewAt: latest.nextReviewAt ?? null,
    };
  }

  return null;
}

/**
 * Refuses a Founder whose access has been suspended or whose account is banned.
 *
 * Fails closed in one direction only, and the asymmetry is deliberate: an
 * unauthenticated request passes THROUGH unanswered, because the routers' own
 * guards already refuse it and answering here would turn this into a second,
 * weaker authentication path. A request that IS authenticated as a Founder and
 * whose standing cannot be read is refused — an unreadable enforcement record
 * is not an absent one.
 */
export function founderStandingGate(db: Database, auth: Auth): RequestHandler {
  return async function standingGuard(req, res, next) {
    let session;
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    } catch {
      // Unreadable session: not this middleware's refusal to make. The route's
      // own `requireRole` will answer 401 a moment from now.
      next();
      return;
    }

    const raw = session?.user as unknown as Record<string, unknown> | undefined;
    if (!session?.user || raw?.['role'] !== 'founder') {
      next();
      return;
    }

    let standing: StandingBlock | null;
    try {
      standing = await readFounderStanding(db, session.user.id);
    } catch {
      res.status(503).json({
        error: 'standing_unavailable',
        title: 'Proovd cannot open your account right now',
        whatHappened:
          'We could not read your account standing, so we did not act on your request. ' +
          'Nothing has been changed.',
        next: 'Try again in a few minutes.',
        support: '/support',
      });
      return;
    }

    if (!standing) {
      next();
      return;
    }

    if (standing.kind === 'banned') {
      // §29.4: the person is told the position plainly. The §22.7 notice
      // itself was delivered when the ban was recorded and is not repeated
      // here — this says the access decision, not the case against them.
      res.status(403).json({
        error: 'account_banned',
        title: 'This account is closed',
        whatHappened:
          'Your Proovd Founder account has been permanently closed following an enforcement ' +
          'decision. You were sent the reason when that decision was made.',
        next: 'If you believe this is wrong, contact support and a person will review it.',
        support: '/support',
      });
      return;
    }

    res.status(403).json({
      error: 'account_suspended',
      title: 'Your Founder access is paused',
      whatHappened:
        'Proovd has paused access to this account while a review is open. Your campaign, ' +
        'your records, and anything already scheduled are unchanged.',
      next: standing.nextReviewAt
        ? `The review is open. The next update is due ${standing.nextReviewAt.toISOString()}.`
        : 'The review is open and a person will come back to you.',
      // §27.1's "who owns this": named when the record names one, and never
      // invented when it does not.
      owner: standing.reviewOwner ?? 'Proovd',
      support: '/support',
    });
  };
}
