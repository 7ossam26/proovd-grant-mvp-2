/**
 * Mounts Better Auth's HTTP surface for the three account roles (§5).
 *
 * Two details here are load-bearing.
 *
 * **No body parser in front of it.** Better Auth's handler consumes the raw
 * request stream itself. An `express.json()` mounted above it leaves the
 * handler reading an already-drained stream, and every POST hangs or 400s — the
 * same failure mode the Stripe webhook routes have, which is why `app.ts`
 * mounts no global parser (tech-stack §6).
 *
 * **Its own rate limit.** Sign-in and password-reset are credential endpoints;
 * the app-wide limiter is sized for ordinary browsing and is far too generous
 * for them (§28.1: rate-limit attempts and resend).
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import type { Auth } from '../auth/auth.js';

/** The prefix Better Auth is configured to own. */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * §28.1's credential-endpoint limit. Thirty attempts per quarter-hour per
 * address is generous for a person signing in and tight for anything guessing.
 *
 * Configurable only because the integration suite signs in as an Admin, a
 * Founder, and several Creators inside one journey and runs that journey many
 * times from one loopback address — a suite that tripped this would turn
 * unrelated assertions into limiter tests. Nothing in production overrides it.
 */
export const AUTH_ROUTE_LIMIT = 30;

export function createAuthRouter(auth: Auth, options: { limit?: number } = {}): Router {
  const router = Router();

  router.use(
    AUTH_BASE_PATH,
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: options.limit ?? AUTH_ROUTE_LIMIT,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
    toNodeHandler(auth),
  );

  return router;
}
