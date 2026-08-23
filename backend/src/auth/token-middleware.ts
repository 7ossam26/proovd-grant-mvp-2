/**
 * Express middleware for the token-bearing surfaces (§7, §8, §19).
 *
 * Ordinarily this layer reads the raw value, asks `token-service.verify()`, and
 * attaches the scoped subject. The Founder guard has two narrow continuations:
 * a historical draft-token reference plus either the draft-scoped flow cookie
 * or the claimed owner's Better Auth session. It still never handles or
 * compares token hashes itself.
 *
 * The subject it attaches is the authorization boundary for everything
 * downstream. §33.1.1: a draft link "grants no other access" — no account, no
 * Admin, no payment, no other Founder's draft. A route that reads
 * `req.draftSubject.campaignDraftId` and scopes its query to it cannot be
 * talked into serving another draft, because no other id ever reaches it.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';
import type {
  AffiliateInvitationSubject,
  DraftSubject,
  MagicLinkSubject,
  TokenService,
  TokenSubject,
  CampaignFollowSubject,
} from './token-service.js';
import type { SecureToken } from '../db/schema/tokens.js';
import type { Database } from '../db/client.js';
import type { Auth } from './auth.js';
import { loadSession } from './guards.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { and, eq, isNotNull } from 'drizzle-orm';
import { sendTokenRejection } from './token-rejection.js';
import { TOKEN_PARAM } from './token-routes.js';
import { readFounderFlowSessionCookie } from './founder-flow-session.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Present only after `requireDraftToken` has admitted the request. */
    draftSubject?: DraftSubject;
    /** Present only after `requireMagicLinkToken` has admitted the request. */
    magicLinkSubject?: MagicLinkSubject;
    /** Present only after `requireAffiliateInvitationToken` has admitted it. */
    affiliateInvitationSubject?: AffiliateInvitationSubject;
    /** Present only after `requireCampaignFollowToken` has admitted it. */
    campaignFollowSubject?: CampaignFollowSubject;
    /** The verified row, for routes that need its version or issue time. */
    secureToken?: SecureToken;
    /** The persistent pre-account session for this exact Founder draft. */
    founderFlowSession?: SecureToken;
  }
}

function readRawToken(req: Request): string {
  const fromPath = req.params[TOKEN_PARAM];
  if (typeof fromPath === 'string' && fromPath.length > 0) return fromPath;

  // Accepted so a client can move the value out of the URL once it has it,
  // which keeps it out of browser history and Referer headers on later calls.
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);

  return '';
}

/**
 * Verification rate limit (§28.1: "rate-limit attempts and resend").
 *
 * The handler is the ordinary rejection, not a 429. A limiter that announces
 * itself tells an attacker their guesses are being counted and, worse, hands
 * them a response that differs from a plain miss — which is the enumeration
 * oracle the whole surface exists to avoid.
 */
export function createTokenVerifyLimiter(overrides: Partial<RateLimitOptions> = {}): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => {
      void sendTokenRejection(res, Date.now());
    },
    ...overrides,
  });
}

/**
 * Resend rate limit (§28.1, §5.5). Tighter than verification: a resend sends
 * mail, so an unthrottled one is a way to use Proovd to flood someone's inbox.
 *
 * §5.5 permits a self-resend only if it stays non-enumerating, so the default
 * shares the opaque rejection path. A route may override the handler with its
 * own single generic failure, but must never report that an unsent message was
 * accepted.
 */
export function createTokenResendLimiter(overrides: Partial<RateLimitOptions> = {}): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => {
      void sendTokenRejection(res, Date.now());
    },
    ...overrides,
  });
}

function createTokenGuard(tokens: TokenService, scope: TokenSubject['scope']): RequestHandler {
  return async function tokenGuard(req: Request, res: Response, next: NextFunction) {
    // Started before any work, so the rejection floor covers the database
    // round-trip that a well-formed-but-wrong token pays and a malformed one
    // does not.
    const startedAt = Date.now();
    const raw = readRawToken(req);

    let result;
    try {
      result = await tokens.verify(raw, scope);
    } catch {
      // A database failure must not become a different-looking response. The
      // caller learns nothing either way.
      await sendTokenRejection(res, startedAt);
      return;
    }

    if (!result.ok) {
      await sendTokenRejection(res, startedAt);
      return;
    }

    req.secureToken = result.token;
    // One branch per scope, and each writes only its own property. A shared
    // `req.subject` would let a route read a subject it was not guarded for.
    if (result.subject.scope === 'founder_draft') {
      req.draftSubject = result.subject;
    } else if (result.subject.scope === 'affiliate_invitation') {
      req.affiliateInvitationSubject = result.subject;
    } else if (result.subject.scope === 'campaign_follow') {
      req.campaignFollowSubject = result.subject;
    } else if (result.subject.scope === 'founder_email_code') {
      // Deliberately writes NOTHING. A six-digit code is checked by
      // `verifyFounderEmailCode` on a route that already holds a verified draft
      // token; it is not a credential a middleware admits, and it must never
      // become one — a request arriving with only a code has no draft this
      // guard could name. The branch exists so the union stays total and a
      // code can never fall through into `magicLinkSubject`.
    } else if (result.subject.scope === 'founder_flow_session') {
      req.founderFlowSession = result.token;
    } else {
      req.magicLinkSubject = result.subject;
    }
    next();
  };
}

/**
 * Admits a Founder draft link and nothing else (§7).
 *
 * A magic link presented here fails: `verify()` is given the expected scope and
 * treats a mismatch as a rejection, so the two surfaces cannot be crossed.
 */
export function requireDraftToken(tokens: TokenService): RequestHandler {
  return createTokenGuard(tokens, 'founder_draft');
}

/**
 * Admits a live Founder invitation, its valid persistent flow session, or the
 * authenticated Founder who already claimed the draft.
 *
 * The fallback never revives a token: the raw value is used only to recover a
 * stable draft reference, then a separately scoped flow token must name that
 * same draft or the Better Auth session must match its claimed owner. A token
 * from another draft/scope and a made-up token receive the same rejection.
 */
export function requireFounderDraftAccess(
  db: Database,
  auth: Auth,
  tokens: TokenService,
): RequestHandler {
  return async function founderDraftAccess(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const raw = readRawToken(req);

    try {
      const restorePersistentAccess = async (draftId: string): Promise<boolean> => {
        const flowRaw = readFounderFlowSessionCookie(req, draftId);
        if (flowRaw) {
          const flow = await tokens.verify(flowRaw, 'founder_flow_session');
          if (
            flow.ok &&
            flow.subject.scope === 'founder_flow_session' &&
            flow.subject.campaignDraftId === draftId
          ) {
            req.founderFlowSession = flow.token;
            return true;
          }
        }

        const session = await loadSession(auth, req);
        if (!session || session.user.role !== 'founder') return false;

        const [owned] = await db
          .select({ draftId: campaignDrafts.id })
          .from(campaignDrafts)
          .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
          .where(
            and(
              eq(campaignDrafts.id, draftId),
              eq(campaignDrafts.status, 'claimed'),
              eq(founderProspects.claimedUserId, session.user.id),
              isNotNull(founderProspects.claimedAt),
            ),
          )
          .limit(1);

        if (!owned) return false;
        req.authUser = session.user;
        req.authSession = session.session;
        return true;
      };

      const verified = await tokens.verify(raw, 'founder_draft');
      if (verified.ok && verified.subject.scope === 'founder_draft') {
        req.secureToken = verified.token;
        req.draftSubject = verified.subject;
        // A live invite remains sufficient for initial access. Restoring a
        // matching flow/account session as well lets the response distinguish
        // "email already verified in this browser" without trusting memory.
        try {
          await restorePersistentAccess(verified.subject.campaignDraftId);
        } catch {
          /* The independently valid invitation still authorizes this request. */
        }
        next();
        return;
      }

      const reference = await tokens.resolveFounderDraftReference(raw);
      if (!reference || !(await restorePersistentAccess(reference.subject.campaignDraftId))) {
        await sendTokenRejection(res, startedAt);
        return;
      }

      req.secureToken = reference.token;
      req.draftSubject = reference.subject;
      next();
    } catch {
      await sendTokenRejection(res, startedAt);
    }
  };
}

/**
 * Admits a Backer magic link and nothing else (§19).
 *
 * The subject carries both the campaign and the Backer identity, because §19
 * grants access to "that Backer's view of that campaign" — one id would be a
 * broader grant than the Spec allows.
 */
export function requireMagicLinkToken(tokens: TokenService): RequestHandler {
  return createTokenGuard(tokens, 'backer_magic_link');
}

/**
 * Admits a private campaign-specific Affiliate invitation and nothing else
 * (§8, §11, §33.2.1).
 *
 * The subject carries one association id, which names exactly one campaign and
 * one prospect. §33.2.1: "an invitation claims only that Affiliate's
 * account/association" — a route downstream of this guard has no other id to
 * scope by, so there is nothing for a caller to substitute. A Founder draft
 * token presented here fails on the scope predicate inside `verify()`, with the
 * same opaque rejection as a token that never existed.
 */
export function requireAffiliateInvitationToken(tokens: TokenService): RequestHandler {
  return createTokenGuard(tokens, 'affiliate_invitation');
}
