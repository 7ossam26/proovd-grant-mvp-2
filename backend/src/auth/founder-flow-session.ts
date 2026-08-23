/**
 * The persistent pre-account Founder Flow cookie.
 *
 * The value is a 256-bit secure token whose hash is stored in `secure_tokens`.
 * The draft id appears only in the cookie name so one browser can keep more
 * than one Founder draft open without one session replacing another. The
 * server still verifies that the token's own subject names that exact draft.
 */

import type { Request, Response } from 'express';
import type { IssuedToken } from './token-service.js';
import { parseCookieHeader } from '../attribution/cookies.js';

const COOKIE_PREFIX = 'pv_founder_flow_';

export function founderFlowSessionCookieName(draftId: string): string {
  return `${COOKIE_PREFIX}${draftId}`;
}

export function readFounderFlowSessionCookie(req: Request, draftId: string): string | null {
  return parseCookieHeader(req.get('cookie') ?? undefined)[founderFlowSessionCookieName(draftId)] ?? null;
}

export function setFounderFlowSessionCookie(
  res: Response,
  draftId: string,
  issued: IssuedToken,
  secure: boolean,
): void {
  const expiresAt = issued.record.expiresAt;
  const maxAge = expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : undefined;

  res.cookie(founderFlowSessionCookieName(draftId), issued.raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/draft',
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
}
