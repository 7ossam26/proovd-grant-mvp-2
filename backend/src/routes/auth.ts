/**
 * Mounts Better Auth's HTTP surface for the three account roles (§5).
 *
 * Better Auth's handler consumes the raw
 * request stream itself. An `express.json()` mounted above it leaves the
 * handler reading an already-drained stream, and every POST hangs or 400s — the
 * same failure mode the Stripe webhook routes have, which is why `app.ts`
 * mounts no global parser (tech-stack §6).
 */

import { Router } from 'express';
import { toNodeHandler } from 'better-auth/node';
import type { Auth } from '../auth/auth.js';

/** The prefix Better Auth is configured to own. */
export const AUTH_BASE_PATH = '/api/auth';

export function createAuthRouter(auth: Auth): Router {
  const router = Router();

  router.use(AUTH_BASE_PATH, toNodeHandler(auth));

  return router;
}
