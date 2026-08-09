/**
 * The account's own identity — Spec §5, §1.1.
 *
 * One read: "who is this session, and therefore where does this person
 * belong?" Every other authenticated route in the product answers a question
 * about a campaign or an association; none of them answers this one, which is
 * why signing in had nowhere to send anybody.
 *
 * ── Why the role is returned at all ─────────────────────────────────────────
 * The three account actors land on three different surfaces (§5.1, §5.2,
 * §5.3), and the sign-in form must not ask which one you are: a page that
 * routes on a self-declared role either trusts the answer — and lets a Creator
 * ask for the Founder surface — or refuses it, and a refusal that varies by
 * role is an account-role oracle. So the server says, once, after the session
 * exists.
 *
 * The value is the INTERNAL role (`affiliate`, not `Creator`). §3.1 forbids
 * rendering it; the caller uses it to choose a route and never prints it. That
 * is the same arrangement `listFounderVisibleRoster` uses for association
 * status — the wire carries the internal name, the surface renders §3's.
 *
 * ── Why it is outside the gated prefixes ────────────────────────────────────
 * `/api/founder` and `/api/creator` sit behind `policyReacceptanceGate`
 * (§29.8). Someone who owes a reacceptance must still be able to learn that
 * they are signed in and where to go — otherwise the acceptance surface is
 * unreachable for exactly the people who need it. `/api/account/*` is already
 * where §29.8 put the acceptance routes, for the same reason.
 *
 * ── What this route deliberately does not do ────────────────────────────────
 * It creates nothing, and it is not a session refresh. `requireSession` reads
 * the session Better Auth already issued and fails closed on absence, on an
 * unreadable role, and on a database error — no branch logs a warning and
 * proceeds (§33.12.5).
 */

import { Router } from 'express';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/guards.js';

export function createAccountRouter(auth: Auth): Router {
  const router = Router();

  router.get('/api/account/me', requireSession(auth), (req, res) => {
    // `requireSession` has already refused every request without one; this
    // narrows the optional rather than deciding access a second time.
    const user = req.authUser;
    if (!user) return;

    res.json({
      account: {
        role: user.role,
        email: user.email,
        name: user.name,
      },
    });
  });

  return router;
}
