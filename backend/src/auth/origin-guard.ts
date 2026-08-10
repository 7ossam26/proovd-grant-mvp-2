/**
 * A second CSRF layer for the Proovd routers — §28.2, defence in depth.
 *
 * ── What was already true, and why it was not enough on its own ─────────────
 * Every Proovd API route authenticates with the Better Auth session COOKIE, so
 * a cross-site request that the browser attaches that cookie to is a request
 * the server would honour. Two things stood between that and a real CSRF:
 *
 *   1. `SameSite=Lax` on the session cookie, which is what actually stops a
 *      malicious page's `fetch`/form POST from carrying it. This is a genuine
 *      protection and it is doing the work today.
 *   2. The CORS allow-list — which does NOT block anything. `cors()` decides
 *      which response headers to set; the request still reaches the handler,
 *      and a POST whose response the attacker never reads is a CSRF that
 *      succeeded.
 *
 * So it was one layer, not two, and it was a layer nobody had written down.
 * Verified rather than assumed: a request carrying a valid Admin cookie and
 * `Origin: https://evil.example` was answered 200 on both a read and a settings
 * write before this file existed.
 *
 * Better Auth already applies its own, stricter check to `/api/auth/*` — it
 * refuses a state-changing request with a missing OR untrusted Origin
 * (`MISSING_OR_NULL_ORIGIN` / `INVALID_ORIGIN`). This brings the same idea to
 * the rest of the API.
 *
 * ── The rule, and why it is not the stricter one ────────────────────────────
 * Refuse a state-changing request whose `Origin` is PRESENT and not trusted.
 * A missing `Origin` is allowed through.
 *
 * That asymmetry is deliberate and is the whole design:
 *
 *  - A browser always sends `Origin` on a cross-origin request, including a
 *    cross-site form POST. So the case this guard exists to stop always
 *    carries one, and is always caught.
 *  - A request with NO `Origin` is a non-browser client — curl, a server, the
 *    integration suite, and the two signed webhook endpoints Stripe and Cal.com
 *    POST to. None of those can be CSRF'd: there is no ambient cookie to
 *    borrow. Refusing them would break the webhooks, which is a real outage in
 *    exchange for no security.
 *
 * Only state-changing methods are checked. A cross-site GET does carry the
 * cookie under `SameSite=Lax` — that is what Lax permits — so a state-changing
 * GET would be reachable; there are none under `/api`, and this guard is not
 * where that would be enforced anyway (a GET that writes is the defect).
 *
 * This does not replace `SameSite`, and removing either is a real weakening.
 */

import type { RequestHandler } from 'express';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function crossOriginWriteGuard(trustedOrigins: readonly string[]): RequestHandler {
  const trusted = new Set(trustedOrigins);

  return function originGuard(req, res, next) {
    if (!STATE_CHANGING.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const origin = req.get('origin');
    // Absent — a non-browser caller. See the header: nothing to borrow.
    if (!origin) {
      next();
      return;
    }
    // `null` is what a sandboxed iframe and some redirect chains send. It is
    // not any of our origins, so it is refused like any other stranger.
    if (trusted.has(origin)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'cross_origin_request_refused',
      title: 'That request did not come from Proovd',
      whatHappened:
        'This request was sent from another website while you were signed in, so Proovd did ' +
        'not act on it. Nothing has been changed.',
      next: 'If you meant to do this, do it from a Proovd page.',
      support: '/support',
    });
  };
}
