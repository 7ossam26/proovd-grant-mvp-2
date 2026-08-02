/**
 * The attribution cookies — Spec §18 (Phase 14b).
 *
 * Two first-party cookies, both HttpOnly and SameSite=Lax so they survive the
 * top-level navigation from a Creator's post to `/c/:code` and back to the
 * campaign page, and neither is readable by page scripts:
 *
 *   pv_vid                a stable visitor id. It groups one browser's clicks in
 *                         the ledger and is the whole of §18's "same
 *                         browser/device" limitation — there is no attempt to
 *                         join it to any other browser (§33.6, "no cross-device
 *                         or cross-browser attribution promise").
 *   pv_attr_<campaignId>  the per-campaign attribution winner. §18: "Its
 *                         first-party cookie expires at `campaign_close_at`." So
 *                         it carries an Expires of exactly that instant — the
 *                         browser drops it at close, which is how "the cookie
 *                         ends at close" (§33.6.2) is enforced by the client,
 *                         not by a server clock.
 *
 * The winner cookie is HMAC-signed with `BETTER_AUTH_SECRET`, domain-separated
 * by a fixed label, so a page script or a hostile client cannot forge a linkId
 * into it. The signature is the same shape `interviews/reference.ts` uses and
 * for the same reason: the value travels through the client, so it must not be
 * trusted on the strength of having arrived.
 *
 * There is no cookie-parser in the app (each router parses its own body, and
 * there is no global `express.json()`), so reading is a hand-rolled parse of the
 * `Cookie` header and writing is `res.cookie`, which needs no parser.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const VISITOR_COOKIE = 'pv_vid';

/** The per-campaign winner cookie name. The id is opaque hex; a valid cookie name. */
export function attributionCookieName(campaignId: string): string {
  return `pv_attr_${campaignId}`;
}

const LABEL = 'proovd:attribution-cookie:v1';

/** A year, in seconds. The visitor id outlives any one campaign's window. */
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** The signed payload the winner cookie carries. Minimal: the link decides the rest. */
export interface AttributionCookiePayload {
  /** The visitor id at the click that set this cookie. */
  v: string;
  /** The winning tracking link's id. Resolution reads its current state. */
  l: string;
  /** The click instant, ISO. §25.2 "clicked-at" / replacement history. */
  t: string;
}

export function signAttribution(payload: AttributionCookiePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const tag = createHmac('sha256', secret).update(`${LABEL}:${body}`).digest('base64url');
  return `${body}.${tag}`;
}

/**
 * The payload a winner cookie carries, or null. Every failure — malformed, bad
 * tag, unparseable — returns null: a forged or corrupt cookie is treated as no
 * attribution at all, never as an error the caller must handle.
 */
export function verifyAttribution(
  value: string | null | undefined,
  secret: string,
): AttributionCookiePayload | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = value.slice(0, dot);
  const provided = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(`${LABEL}:${body}`).digest('base64url');

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as AttributionCookiePayload).v === 'string' &&
      typeof (parsed as AttributionCookiePayload).l === 'string' &&
      typeof (parsed as AttributionCookiePayload).t === 'string'
    ) {
      return parsed as AttributionCookiePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse a raw `Cookie` header into a name→value map. Values are URL-decoded. */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}
