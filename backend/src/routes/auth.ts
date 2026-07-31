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

export function createAuthRouter(auth: Auth): Router {
  const router = Router();

  router.use(
    AUTH_BASE_PATH,
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
    toNodeHandler(auth),
  );

  return router;
}
