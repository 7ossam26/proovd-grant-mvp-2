/**
 * The signed-in Creator's surface — Spec §10, §31.5, §5.3, §33.2.4.
 *
 * The first session-bearing routes for an actor other than Admin. §10's handoff
 * is to "every eligible **authenticated** Affiliate", and 08b burned the
 * invitation token when it created the account — so from here on a Creator
 * arrives with a session, not a link.
 *
 * ── Everything here is scoped by the session, not by a parameter ────────────
 * `requireRole(auth, 'affiliate')` establishes who is asking, and every read
 * below filters on that user id inside the query. There is no campaign id in a
 * request that is not first checked against the caller's own associations, and
 * an association belonging to someone else answers `not_found` — the same
 * answer as one that does not exist, so nothing can be enumerated.
 *
 * ── No second factor here, and that is the Spec's rule, not an omission ────
 * §5.3 gives the Affiliate "email + password, private campaign-specific
 * invitation only". Requiring a factor the Spec does not ask for would lock out
 * every Creator who signed up under 08b, and inventing an authentication policy
 * is as much a §1 rule 6 violation as inventing a commercial one.
 *
 * §5.1 used to make a second factor mandatory for Admin, which is the contrast
 * this note was written against. That layer was removed on 2026-08-10 by
 * product direction (see `auth/auth.ts`), so no role has one now — which
 * changes nothing here, because this route never had one to lose.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * Accept, decline, propose, activate. §10: the Creator "cannot accept, decline,
 * propose compensation, activate a link, or begin work until listing-fee
 * payment makes the formal opportunity actionable." Those are Phase 12's, and
 * there is no route here to reach them early — not a disabled one, absent.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import { readPreparingKit, listCreatorCampaigns } from '../affiliates/kit.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { submitPost } from '../launch/post-verification.js';
import { notifyPostVerificationDue } from '../notifications/internal-queue.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { buildCreatorPartnership } from '../affiliates/partnership.js';
import { readCreatorClose } from '../close/creator-close.js';
import { creatorProspectId, readCreatorHome } from '../affiliates/home.js';
import { listCreatorReferrals, recordCreatorReferral } from '../affiliates/referrals.js';

export const CREATOR_PATH = '/api/creator';

/**
 * §27.6's `internal_post_verification_due` is the reason this router gained a
 * notifier (Phase 22b) — it was the last unsent key whose blocker was a router
 * signature rather than a missing record. The three new fields are optional and
 * grouped, so the four positional arguments every existing caller passes still
 * work: an options object would have been tidier and would have touched every
 * call site for one message.
 */
export interface CreatorRouterExtras {
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  /** §27.6's inbox. Absent → the submission is still in the Admin queue. */
  internalRecipient?: string | undefined;
}

export function createCreatorRouter(
  db: Database,
  auth: Auth,
  audit: AuditWriter,
  appBaseUrl: string,
  extras: CreatorRouterExtras = {},
): Router {
  const router = Router();
  const creator = requireRole(auth, 'affiliate');
  const json: RequestHandler = express.json({ limit: '8kb' });

  const internalDeps = () => ({
    db,
    ...(extras.notifier ? { notifier: extras.notifier } : {}),
    ...(extras.context ? { context: extras.context } : {}),
    ...(extras.internalRecipient ? { internalRecipient: extras.internalRecipient } : {}),
  });

  function actorId(req: express.Request): string {
    return req.authUser?.id ?? '';
  }

  /** True when this association belongs to the caller — scoped inside the query. */
  async function ownsAssociation(associationId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: affiliateSignupProfiles.id })
      .from(affiliateSignupProfiles)
      .where(
        and(
          eq(affiliateSignupProfiles.associationId, associationId),
          eq(affiliateSignupProfiles.claimedUserId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** The Creator's own campaigns. Scoped by session; no id in the request. */
  router.get(`${CREATOR_PATH}/campaigns`, creator, async (req, res) => {
    const rows = await listCreatorCampaigns(db, actorId(req));
    res.json({
      campaigns: rows.map((row) => ({
        ...row,
        revealedAt: row.revealedAt?.toISOString() ?? null,
      })),
    });
  });

  /**
   * The preparing Campaign kit for one association.
   *
   * The read logs itself (§31.5) — `readPreparingKit` writes the access row in
   * the same call that returns the content, rather than relying on a middleware
   * a later route could be added without.
   */
  router.get(`${CREATOR_PATH}/campaigns/:associationId`, creator, async (req, res) => {
    const section = req.query['section'] === 'campaign_kit' ? 'campaign_kit' : 'campaign_information';

    const result = await readPreparingKit(db, {
      associationId: req.params['associationId'] as string,
      affiliateUserId: actorId(req),
      section,
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 403).json({
        error: result.code,
        title:
          result.code === 'revoked'
            ? 'This campaign is no longer available to you'
            : result.code === 'not_revealed'
              ? 'Not ready yet'
              : 'Campaign not found',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }

    res.json({ kit: result.kit });
  });

  /**
   * §17 step 4: the Creator submits the public post URL. Scoped by session —
   * an association that is not the caller's answers `not_found`, the same answer
   * as one that does not exist. Refused until the link is live (post third,
   * after link second).
   */
  router.post(`${CREATOR_PATH}/campaigns/:associationId/submit-post`, creator, json, async (req, res) => {
    const associationId = req.params['associationId'] as string;
    const userId = actorId(req);
    if (!(await ownsAssociation(associationId, userId))) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const postUrl = typeof body['postUrl'] === 'string' ? body['postUrl'].trim() : '';
    if (!/^https?:\/\/\S+$/i.test(postUrl)) {
      res.status(422).json({
        error: 'invalid_url',
        whatHappened: 'Enter the full public URL of your post, starting with http:// or https://.',
      });
      return;
    }

    const result = await submitPost(db, { audit }, {
      associationId,
      postUrl,
      channel: typeof body['channel'] === 'string' ? body['channel'] : undefined,
      submittedBy: `user:${userId}`,
    });

    if (result.status === 'submitted') {
      // §27.6: step 5 is Admin's, and nothing told Admin the work had arrived
      // (Phase 22b). Deduped on the SUBMISSION, so a corrected resubmission is
      // a new decision and a double-click is not. `alreadyExisted` is not
      // consulted: the dedup answers it, and a re-post after a correction is
      // the case where the notice matters most.
      await notifyPostVerificationDue(internalDeps(), {
        submissionId: result.submission.id,
        associationId,
        campaignId: result.submission.campaignId,
        postUrl: result.submission.postUrl,
        channel: result.submission.channel,
        resubmission: result.alreadyExisted,
      });

      res.json({
        submission: {
          id: result.submission.id,
          status: result.submission.status,
          postUrl: result.submission.postUrl,
          submittedAt: result.submission.submittedAt.toISOString(),
          alreadyExisted: result.alreadyExisted,
        },
      });
      return;
    }
    if (result.status === 'not_active') {
      res.status(409).json({ error: 'not_active', whatHappened: result.message });
      return;
    }
    res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
  });

  /**
   * §18 item 6 — the Creator active-partnership surface. Scoped by session: an
   * association that is not the caller's answers `not_found`, the same answer a
   * non-existent one gets. Available once the Creator has accepted; before that
   * the opportunity/kit surfaces apply, so a pre-acceptance association answers
   * 409 pointing there.
   */
  router.get(`${CREATOR_PATH}/campaigns/:associationId/partnership`, creator, async (req, res) => {
    const associationId = req.params['associationId'] as string;
    if (!(await ownsAssociation(associationId, actorId(req)))) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }
    const result = await buildCreatorPartnership(db, { associationId, appBaseUrl });
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        title: result.code === 'not_active' ? 'Not an active partnership yet' : 'Campaign not found',
        whatHappened:
          result.code === 'not_active'
            ? 'This becomes your partnership dashboard once you accept the campaign. Review the opportunity first.'
            : 'That campaign could not be found.',
      });
      return;
    }
    res.json({ partnership: result.partnership });
  });

  /**
   * §21's Creator close surface (Phase 18b): content verified, attributed
   * pre-orders and captures, estimated earnings as Appendix B.7, the next
   * review date, and a factual thank-you — with no ranking anywhere (§30).
   * Scoped by session exactly as the partnership read is.
   */
  router.get(`${CREATOR_PATH}/campaigns/:associationId/close`, creator, async (req, res) => {
    const associationId = req.params['associationId'] as string;
    if (!(await ownsAssociation(associationId, actorId(req)))) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }
    const result = await readCreatorClose(db, { associationId });
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        title: result.code === 'not_closed' ? 'The campaign has not closed yet' : 'Campaign not found',
        whatHappened:
          result.code === 'not_closed'
            ? 'Close results exist once the campaign closes. Until then your partnership dashboard is the live view.'
            : 'That campaign could not be found.',
      });
      return;
    }
    res.json({ close: result.view });
  });

  /**
   * The Creator's home — Creator Flow v2 deviation 5, Session D.
   *
   * Scoped by session throughout: the §8 prospect id is resolved from the
   * caller's own claimed profile inside `readCreatorHome`, and there is no id in
   * this request at all.
   *
   * ── What is NOT in this payload, and the suite asserts it ────────────────
   * A notification count. 22c's history has no count by design, and a badge
   * here would be the first of the four things that turn it into a dashboard.
   * The rail's Updates control opens the history and shows a list.
   */
  router.get(`${CREATOR_PATH}/home`, creator, async (req, res) => {
    const home = await readCreatorHome(db, actorId(req));
    res.json({
      home: {
        ...home,
        trackRecord: {
          ...home.trackRecord,
          // §33.8.13's rule at the wire: money is integer cents everywhere and
          // `bigint` does not serialize, so it crosses as a string and the
          // surface formats it. Nothing computes on it in the browser.
          backedCents: home.trackRecord.backedCents.toString(),
        },
        standing: home.standing
          ? { ...home.standing, computedAt: home.standing.computedAt.toISOString() }
          : null,
        workAgain: home.workAgain.map((row) => ({
          ...row,
          requestedAt: row.requestedAt.toISOString(),
        })),
        referrals: home.referrals.map((row) => ({
          ...row,
          recordedAt: row.recordedAt.toISOString(),
        })),
      },
    });
  });

  /**
   * Record a referral — deviation 3.
   *
   * This creates no account, no prospect row, no association, and no token. It
   * writes one row and one audit event, and the audit event is how it reaches
   * an Admin: there is no §27 key for a referral and inventing one would be
   * inventing a message the Spec does not define.
   *
   * The referrer is resolved from the SESSION and never from the body — a
   * caller that could name its own referrer could attribute a vouch to somebody
   * else, which is `routes/vetting.ts`'s recorded identity mistake.
   */
  router.post(`${CREATOR_PATH}/referrals`, creator, json, async (req, res) => {
    const prospectId = await creatorProspectId(db, actorId(req));
    if (!prospectId) {
      res.status(404).json({ error: 'not_found', title: 'Account not found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');

    const result = await recordCreatorReferral(db, audit, {
      referrerProspectId: prospectId,
      actorId: `user:${actorId(req)}`,
      referredName: text(body['referredName']),
      referredContact: text(body['referredContact']),
      relationship: text(body['relationship']),
      why: text(body['why']),
      note: text(body['note']) || undefined,
    });

    if (!result.ok) {
      res.status(422).json({
        error: result.code,
        title: 'We need a little more',
        whatHappened: result.message,
        missing: result.missing,
        next: 'Fill in the four answers and send it again.',
        support: '/support',
      });
      return;
    }

    res.json({ referrals: await listCreatorReferrals(db, prospectId) });
  });

  return router;
}
