/**
 * Route guards for the three account roles (§5.1, §5.2, §5.3, §28.2).
 *
 * Every guard here **fails closed**. No session, an unreadable session, a
 * database error, a missing role, an Admin without a registered factor, a
 * session older than the reauthentication window — each of these blocks the
 * request. None of them logs a warning and proceeds. §33.12.5 tests precisely
 * that: "MFA is enforced and sensitive action without recent reauthentication
 * fails safely."
 *
 * These errors are not the token surface and must not copy its silence. A
 * signed-in Admin who needs to reauthenticate has already proved who they are;
 * telling them plainly what happened and how to continue is what §27.1
 * requires, and hiding it would just make them retry until something broke.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth.js';
import type { ProovdRole } from '../db/schema/auth.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: ProovdRole;
  twoFactorEnabled: boolean;
}

export interface AuthenticatedSession {
  id: string;
  createdAt: Date;
  expiresAt: Date;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthenticatedUser;
    authSession?: AuthenticatedSession;
  }
}

const ROLES: readonly ProovdRole[] = ['admin', 'founder', 'affiliate'];

function isRole(value: unknown): value is ProovdRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Reads and normalises the session. Returns null on absence *and* on error —
 * the caller cannot tell the difference and must not, because both mean "not
 * authenticated" and treating an error as anything else is how a fail-open bug
 * gets written.
 */
async function loadSession(
  auth: Auth,
  req: Request,
): Promise<{ user: AuthenticatedUser; session: AuthenticatedSession } | null> {
  let result;
  try {
    result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch {
    return null;
  }
  if (!result?.user || !result.session) return null;

  const raw = result.user as unknown as Record<string, unknown>;
  if (!isRole(raw['role'])) return null;

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: raw['role'],
      twoFactorEnabled: raw['twoFactorEnabled'] === true,
    },
    session: {
      id: result.session.id,
      createdAt: new Date(result.session.createdAt),
      expiresAt: new Date(result.session.expiresAt),
    },
  };
}

function unauthenticated(res: Response): void {
  res.status(401).json({
    error: 'authentication_required',
    title: 'Please sign in',
    next: 'Sign in to continue. Nothing has changed while you were signed out.',
  });
}

/** Attaches the session, or refuses. Every other guard builds on this. */
export function requireSession(auth: Auth): RequestHandler {
  return async function sessionGuard(req: Request, res: Response, next: NextFunction) {
    const loaded = await loadSession(auth, req);
    if (!loaded) {
      unauthenticated(res);
      return;
    }
    req.authUser = loaded.user;
    req.authSession = loaded.session;
    next();
  };
}

/**
 * Restricts a route to one or more roles.
 *
 * The message names no other role and offers no switch — a Founder who reaches
 * an Admin route learns that this is not theirs, not what lives behind it.
 */
export function requireRole(auth: Auth, ...allowed: ProovdRole[]): RequestHandler {
  return async function roleGuard(req: Request, res: Response, next: NextFunction) {
    const loaded = req.authUser && req.authSession
      ? { user: req.authUser, session: req.authSession }
      : await loadSession(auth, req);

    if (!loaded) {
      unauthenticated(res);
      return;
    }
    req.authUser = loaded.user;
    req.authSession = loaded.session;

    if (!allowed.includes(loaded.user.role)) {
      res.status(403).json({
        error: 'forbidden',
        title: 'This area is not available to your account',
        next: 'If you think it should be, contact support and we will check.',
        support: '/support',
      });
      return;
    }
    next();
  };
}

/**
 * Admin, with a registered TOTP factor. §5.1: "Email/password authentication
 * and MFA are mandatory." §28.2: "MFA required."
 *
 * Mandatory means an Admin without a factor cannot reach any operational
 * surface — not a nag banner, not a reminder on next login. The plugin makes
 * enrolment possible; this refusal is what makes it required.
 */
export function requireAdmin(auth: Auth): RequestHandler {
  const roleGuard = requireRole(auth, 'admin');
  return async function adminGuard(req: Request, res: Response, next: NextFunction) {
    roleGuard(req, res, () => {
      if (!req.authUser?.twoFactorEnabled) {
        res.status(403).json({
          error: 'mfa_enrollment_required',
          title: 'Set up two-factor authentication to continue',
          whatHappened:
            'Admin accounts require an authenticator app. This one does not have it yet.',
          next: 'Register an authenticator app, then sign in again.',
          action: '/admin/security/two-factor',
        });
        return;
      }
      next();
    });
  };
}

/**
 * The recent-reauthentication gate (§5.1, §28.2, §33.12.5).
 *
 * §5.1 names what it covers: "Money movement, refund, connected-account,
 * campaign kill/suspend, and other high-impact actions require recent
 * reauthentication." Freshness is measured from the session's own creation, so
 * a session that has merely been *used* recently is not fresh — only one that
 * was recently established by proving a credential again.
 *
 * `window` is the §6 Admin setting. It has no default here: the Spec states the
 * setting exists but not its value, and a number invented in code is a
 * commercial rule invented in code (§1 rule 6).
 *
 * Phase 06 moved that setting into `app_settings`, so this accepts a resolver
 * as well as a number — passing a function makes a change to the window take
 * effect on the next request rather than the next deployment. A resolver that
 * returns `null`, or throws, blocks: an unreadable security policy is not a
 * permissive one.
 */
export type FreshnessWindow = number | (() => Promise<number | null> | number | null);

async function resolveWindowSeconds(window: FreshnessWindow): Promise<number | null> {
  if (typeof window === 'number') return window;
  try {
    return await window();
  } catch {
    return null;
  }
}

export function requireFreshSession(auth: Auth, window: FreshnessWindow): RequestHandler {
  return async function freshnessGuard(req: Request, res: Response, next: NextFunction) {
    const loaded = req.authUser && req.authSession
      ? { user: req.authUser, session: req.authSession }
      : await loadSession(auth, req);

    if (!loaded) {
      unauthenticated(res);
      return;
    }
    req.authUser = loaded.user;
    req.authSession = loaded.session;

    const windowSeconds = await resolveWindowSeconds(window);
    if (windowSeconds === null || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      res.status(503).json({
        error: 'reauthentication_window_unconfigured',
        title: 'This action is unavailable right now',
        whatHappened:
          'The Admin reauthentication window has no value, so Proovd cannot tell whether your ' +
          'sign-in is recent enough for an action of this kind.',
        // No `action` link: the §6 global-configuration SURFACE is not built in
        // this phase, though `PUT /api/admin/settings/:key` still is. Naming a
        // page that does not exist is the §1.4 failure this guard is otherwise
        // careful to avoid — an Admin following a dead link learns nothing and
        // loses the context they were in. Restore the link when the
        // configuration workspace ships.
        next:
          'The Admin reauthentication window must be given a value in global configuration ' +
          'before actions of this kind can be taken.',
        support: '/support',
      });
      return;
    }

    const ageSeconds = (Date.now() - loaded.session.createdAt.getTime()) / 1000;

    // Fails closed on an unusable timestamp too: a NaN age is not a fresh
    // session, and `!(NaN <= w)` is what keeps it from being treated as one.
    if (!(ageSeconds <= windowSeconds)) {
      res.status(403).json({
        error: 'reauthentication_required',
        title: 'Confirm it is you to continue',
        whatHappened:
          'This action moves money or changes a live campaign, so it needs a recent sign-in. ' +
          'Yours is older than the window Proovd allows.',
        next: 'Sign in again and we will bring you straight back here. Nothing has been changed.',
        action: '/sign-in',
        support: '/support',
      });
      return;
    }
    next();
  };
}
