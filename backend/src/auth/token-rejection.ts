/**
 * The one response every token failure produces (§5.5, §28.1).
 *
 * Invalid, expired, revoked, claimed, malformed, rate-limited, and
 * never-existed all end here, with the same status, the same body, and the same
 * headers. §5.5 requires that an invalid link "expose no account existence or
 * PII"; a response that differs by failure mode exposes exactly that, one bit
 * at a time, to anyone willing to send a few thousand requests.
 *
 * ── Rules this file exists to keep ──────────────────────────────────────────
 *  - The body is a frozen constant. Nothing per-request goes into it — not an
 *    incident id, not a timestamp, not a retry hint. Anything that varies is
 *    something an attacker can measure.
 *  - One status code. A 404 for "no such token" beside a 410 for "revoked" is
 *    an enumeration oracle even when the bodies match, and a 429 from a rate
 *    limiter is the same oracle wearing a different hat — which is why the
 *    limiter on these routes is wired to this function too.
 *  - No reason field, ever. `TokenInvalid` deliberately carries none; if one
 *    existed here, someone would eventually render it. The reason is in the
 *    audit log, where support can read it and the caller cannot.
 */

import type { Response } from 'express';

/**
 * 401 for every mode. The link is a credential, so "unauthenticated" is the
 * honest status, and it is the same one whether the credential was mistyped,
 * expired last month, or never existed.
 */
export const TOKEN_REJECTION_STATUS = 401;

/**
 * Customer-facing copy, and the whole of it. §5.5 wants three things: say the
 * link cannot be used, reveal nothing, and offer a way to reach a human
 * without losing context. The support route is a fixed path — the surface the
 * caller is already on is what preserves the context, not a value in this body,
 * because a value in this body is a value that can vary.
 *
 * The wording says nothing about *why*, and it names no account, address, or
 * campaign. "We can't open this link" is true of all seven modes.
 */
export const TOKEN_REJECTION_BODY = Object.freeze({
  error: 'link_unavailable',
  title: "We can't open this link",
  detail:
    'This link is no longer usable. That can happen for a few reasons, and we ' +
    "can't tell which from here — so nothing is wrong with your account, and " +
    'nothing has been charged.',
  next: 'Ask the person who sent it for a new one, or contact support and we can help.',
  support: '/support/link',
});

/**
 * Padding floor for rejections, in milliseconds.
 *
 * Not decoration. The verification path returns early for malformed input
 * before it touches the database, and a database round-trip is measurable, so
 * "malformed" and "wrong but well-formed" are distinguishable by a stopwatch
 * unless every rejection is held to the same floor. §28.1 asks for
 * non-enumerating errors; a timing side channel enumerates just as well as a
 * status code.
 */
export const REJECTION_FLOOR_MS = 120;

/** Sends the single rejection, padded so all modes take comparable time. */
export async function sendTokenRejection(res: Response, startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = REJECTION_FLOOR_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  if (res.headersSent) return;
  res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
}
