/**
 * `JSON.stringify` cannot serialize a BigInt, and money in this product is
 * `bigint` all the way down.
 *
 * Every amount is integer cents in a `bigint` column read with Drizzle's
 * `mode: 'bigint'`, so a service that returns rows straight from the database —
 * `readCampaignEarnings` is the one that does — hands the route a value
 * `res.json` throws on. Express catches the throw and answers 500, which on a
 * money surface is the worst sentence the product can produce: the read failed
 * and it is not certain why.
 *
 * ── Why this converts to a string rather than a number ──────────────────────
 * A cent count above 2^53 is not a number JavaScript can hold, and the whole
 * point of `bigint` in this codebase is that nothing rounds. Every existing
 * money payload already crosses the wire as a decimal string (`'12000'`), and
 * the frontend's own types say so — so this makes an accidentally-raw row match
 * what the deliberately-shaped payloads have always sent.
 *
 * ── It is a route-layer fix, on purpose ─────────────────────────────────────
 * The services keep returning domain values: a `bigint` is the right type for
 * an amount and `close/earnings.ts` should not know that something downstream
 * serializes. This runs where the domain leaves the process.
 */

import type { RequestHandler } from 'express';

/** Recursively replaces every `bigint` with its decimal string. */
export function jsonSafe<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  // A Date serializes correctly on its own, and rebuilding one as a plain
  // object would turn every timestamp in the payload into `{}`.
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(convert);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = convert(entry);
  }
  return out;
}

/**
 * Mounts `jsonSafe` on one router's `res.json`, so no route on it can forget.
 *
 * Applied per route it is a line somebody adds when they notice the 500 —
 * which means it is missing on every route nobody has driven yet, and the
 * §33 suites drive these services rather than their routes. Applied here it is
 * a property of the router: a route added next year serializes correctly
 * without its author knowing this file exists.
 *
 * The same shape as the gateway decorator's reason in `live-mode/guard.ts` —
 * put the guarantee at the one chokepoint every caller already goes through.
 */
export const bigintSafeJson: RequestHandler = (_req, res, next) => {
  const original = res.json.bind(res);
  res.json = (body: unknown) => original(jsonSafe(body));
  next();
};
