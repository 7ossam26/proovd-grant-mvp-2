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

import express, { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Auth } from '../auth/auth.js';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireSession } from '../auth/guards.js';
import {
  createFounderAccountPublicly,
  readSignupAvailability,
} from '../auth/public-signup.js';

/**
 * Public Founder signup is an unauthenticated write that creates an account,
 * so it is bounded before it is anything else. The limit is per IP and covers
 * both the availability read and the create — the read is what an enumerator
 * would use to check the door is open before hammering it.
 *
 * This is also the only mitigation standing behind `email_taken`: see the
 * comment on that branch in `public-signup.ts` for why a signup form cannot
 * honour §5.5's non-enumeration rule the way the reset surface does.
 */
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_LIMIT = 10;

export interface AccountRouterDeps {
  auth: Auth;
  db: Database;
  audit: AuditWriter;
}

export function createAccountRouter({ auth, db, audit }: AccountRouterDeps): Router {
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

  /* ── Public Founder signup (operator decision; see auth/public-signup.ts) ── */

  const signupLimiter = rateLimit({
    windowMs: SIGNUP_WINDOW_MS,
    limit: SIGNUP_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  // Per-router, never global — `app.ts` mounts no `express.json()` because the
  // Stripe and Cal.com webhooks verify signatures over the raw bytes.
  const json: RequestHandler = express.json({ limit: '8kb' });

  /**
   * Whether the door is open, so the surface can render the closed state as a
   * state rather than as a rejected form (§27.1, §1.1). Read-only; creates
   * nothing.
   */
  router.get('/api/account/signup', signupLimiter, (_req, res) => {
    void (async () => {
      try {
        res.json(await readSignupAvailability(db));
      } catch {
        // Fail closed. A signup form rendered because availability could not
        // be read is a form that collects a password and then refuses.
        res.status(503).json({
          open: false,
          reason: 'unavailable',
          title: 'Signups cannot be opened right now',
          whatHappened:
            'Proovd could not check whether new accounts are being accepted. Nothing was created.',
          next: 'Try again in a few minutes.',
        });
      }
    })();
  });

  router.post('/api/account/signup', signupLimiter, json, (req, res) => {
    void (async () => {
      const body = (req.body ?? {}) as Partial<{
        email: string;
        password: string;
        name: string;
        acceptedPolicySlugs: string[];
      }>;

      try {
        const result = await createFounderAccountPublicly(db, auth, audit, {
          email: typeof body.email === 'string' ? body.email : '',
          password: typeof body.password === 'string' ? body.password : '',
          name: typeof body.name === 'string' ? body.name : '',
          acceptedPolicySlugs: Array.isArray(body.acceptedPolicySlugs)
            ? body.acceptedPolicySlugs.filter((s): s is string => typeof s === 'string')
            : [],
        });

        if (!result.ok) {
          // 409 for the two states that are about the world rather than the
          // request: the agreements are not final, or the address is taken.
          const status =
            result.code === 'policies_unpublished' || result.code === 'email_taken' ? 409 : 400;
          res.status(status).json(result);
          return;
        }

        // No session is minted here. The surface signs in through the ordinary
        // `/api/auth/sign-in/email` path immediately afterwards, so there is
        // exactly one place in the product that issues a session and it is the
        // one every other door already uses.
        res.status(201).json({ ok: true, email: result.email });
      } catch {
        res.status(500).json({
          ok: false,
          code: 'unavailable',
          message: 'Your account could not be created.',
          next: 'Nothing was created. Try again in a few minutes.',
        });
      }
    })();
  });

  return router;
}
