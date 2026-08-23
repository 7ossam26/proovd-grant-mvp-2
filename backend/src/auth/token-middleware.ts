/**
 * Express middleware for the three token-bearing surfaces (§7, §8, §19).
 *
 * This layer does three things and no more: read the raw value out of the URL,
 * hand it to `token-service.verify()`, and attach the scoped subject to the
 * request. It does not reimplement verification, does not inspect the hash, and
 * does not learn why a token was rejected — `verify()` returns one opaque
 * failure by design and this file is not entitled to more.
 *
 * The subject it attaches is the authorization boundary for everything
 * downstream. §33.1.1: a draft link "grants no other access" — no account, no
 * Admin, no payment, no other Founder's draft. A route that reads
 * `req.draftSubject.campaignDraftId` and scopes its query to it cannot be
 * talked into serving another draft, because no other id ever reaches it.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type {
  AffiliateInvitationSubject,
  DraftSubject,
  MagicLinkSubject,
  TokenService,
  TokenSubject,
  CampaignFollowSubject,
} from './token-service.js';
import type { SecureToken } from '../db/schema/tokens.js';
import { sendTokenRejection } from './token-rejection.js';
import { TOKEN_PARAM } from './token-routes.js';

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
